// Command projectcallgraph emits the Go half of the monorepo call graph.
// It uses the standard parser so repository checks need no analyzer binary or
// sibling checkout. Resolution is deliberately conservative: exact package
// functions, exact receiver methods, and imported package functions become
// edges; dynamic/interface calls remain absent rather than guessed.
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

type graphNode struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	File       string `json:"file"`
	Line       int    `json:"line"`
	Language   string `json:"language"`
	Kind       string `json:"kind"`
	Subsystem  string `json:"subsystem"`
	Group      string `json:"group"`
	Production bool   `json:"production"`
}

type graphEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Kind   string `json:"kind"`
}

type graphDocument struct {
	Nodes []graphNode `json:"nodes"`
	Edges []graphEdge `json:"edges"`
}

type sourceRecord struct {
	absPath    string
	relPath    string
	packageID  string
	moduleID   string
	production bool
	file       *ast.File
}

type functionRecord struct {
	id        string
	name      string
	receiver  string
	packageID string
	file      *sourceRecord
	decl      *ast.FuncDecl
}

func main() {
	root, err := os.Getwd()
	if err != nil {
		fatal(err)
	}
	modulePath, err := readModulePath(filepath.Join(root, "go.mod"))
	if err != nil {
		fatal(err)
	}
	graph, err := buildGraph(root, modulePath)
	if err != nil {
		fatal(err)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(graph); err != nil {
		fatal(err)
	}
}

func fatal(err error) {
	_, _ = fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

func readModulePath(filename string) (string, error) {
	payload, err := os.ReadFile(filename)
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(payload), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "module" {
			return fields[1], nil
		}
	}
	return "", fmt.Errorf("go.mod has no module directive")
}

func buildGraph(root, modulePath string) (graphDocument, error) {
	files, err := collectGoFiles(root)
	if err != nil {
		return graphDocument{}, err
	}
	fset := token.NewFileSet()
	records := make([]*sourceRecord, 0, len(files))
	nodes := make(map[string]graphNode)
	edges := make(map[string]graphEdge)
	functionsByPackage := make(map[string]map[string]*functionRecord)
	methodsByPackage := make(map[string]map[string]*functionRecord)
	modulesByPackage := make(map[string][]*sourceRecord)

	for _, filename := range files {
		parsed, parseErr := parser.ParseFile(fset, filename, nil, 0)
		if parseErr != nil {
			return graphDocument{}, fmt.Errorf("parse %s: %w", filename, parseErr)
		}
		relative, relErr := filepath.Rel(root, filename)
		if relErr != nil {
			return graphDocument{}, relErr
		}
		relative = filepath.ToSlash(relative)
		directory := path.Dir(relative)
		packageID := modulePath
		if directory != "." {
			packageID += "/" + directory
		}
		record := &sourceRecord{
			absPath:    filename,
			relPath:    relative,
			packageID:  packageID,
			moduleID:   "go:module:" + relative,
			production: !strings.HasSuffix(relative, "_test.go"),
			file:       parsed,
		}
		records = append(records, record)
		modulesByPackage[packageID] = append(modulesByPackage[packageID], record)
		nodes[record.moduleID] = makeNode(
			record.moduleID, path.Base(relative), relative, 1, "module", record.production,
		)

		for _, declaration := range parsed.Decls {
			function, ok := declaration.(*ast.FuncDecl)
			if !ok || function.Body == nil {
				continue
			}
			receiver := receiverName(function)
			label := function.Name.Name
			kind := "function"
			if receiver != "" {
				label = receiver + "." + label
				kind = "method"
			}
			line := fset.Position(function.Pos()).Line
			id := fmt.Sprintf("go:%s:%d:%s", relative, line, label)
			item := &functionRecord{
				id: id, name: function.Name.Name, receiver: receiver,
				packageID: packageID, file: record, decl: function,
			}
			nodes[id] = makeNode(id, label, relative, line, kind, record.production)
			addEdge(edges, record.moduleID, id, "owns")
			if receiver == "" {
				if functionsByPackage[packageID] == nil {
					functionsByPackage[packageID] = make(map[string]*functionRecord)
				}
				functionsByPackage[packageID][item.name] = item
			} else {
				if methodsByPackage[packageID] == nil {
					methodsByPackage[packageID] = make(map[string]*functionRecord)
				}
				methodsByPackage[packageID][receiver+"."+item.name] = item
			}
		}
	}

	for _, record := range records {
		indexRecordCalls(record, fset, modulePath, modulesByPackage, functionsByPackage, methodsByPackage, edges)
	}

	document := graphDocument{
		Nodes: make([]graphNode, 0, len(nodes)),
		Edges: make([]graphEdge, 0, len(edges)),
	}
	for _, node := range nodes {
		document.Nodes = append(document.Nodes, node)
	}
	for _, edge := range edges {
		document.Edges = append(document.Edges, edge)
	}
	sort.Slice(document.Nodes, func(i, j int) bool { return document.Nodes[i].ID < document.Nodes[j].ID })
	sort.Slice(document.Edges, func(i, j int) bool {
		left := document.Edges[i]
		right := document.Edges[j]
		return left.Source < right.Source ||
			left.Source == right.Source && (left.Target < right.Target ||
				left.Target == right.Target && left.Kind < right.Kind)
	})
	return document, nil
}

func collectGoFiles(root string) ([]string, error) {
	var files []string
	err := filepath.WalkDir(root, func(filename string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if filename != root && (strings.HasPrefix(entry.Name(), ".") || entry.Name() == "vendor") {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(strings.ToLower(entry.Name()), ".go") {
			files = append(files, filename)
		}
		return nil
	})
	sort.Strings(files)
	return files, err
}

func indexRecordCalls(
	record *sourceRecord,
	fset *token.FileSet,
	modulePath string,
	modulesByPackage map[string][]*sourceRecord,
	functionsByPackage map[string]map[string]*functionRecord,
	methodsByPackage map[string]map[string]*functionRecord,
	edges map[string]graphEdge,
) {
	imports := make(map[string]string)
	for _, spec := range record.file.Imports {
		importPath := strings.Trim(spec.Path.Value, "\"")
		alias := path.Base(importPath)
		if spec.Name != nil && spec.Name.Name != "_" && spec.Name.Name != "." {
			alias = spec.Name.Name
		}
		imports[alias] = importPath
		if strings.HasPrefix(importPath, modulePath) {
			if target := preferredModule(modulesByPackage[importPath]); target != nil {
				addEdge(edges, record.moduleID, target.moduleID, "imports")
			}
		}
	}

	for _, declaration := range record.file.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Body == nil {
			continue
		}
		owner := functionID(record, fset, function)
		receiverVariable := ""
		receiverType := receiverName(function)
		if function.Recv != nil && len(function.Recv.List) > 0 && len(function.Recv.List[0].Names) > 0 {
			receiverVariable = function.Recv.List[0].Names[0].Name
		}
		ast.Inspect(function.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			target := resolveCall(
				call.Fun,
				record.packageID,
				receiverVariable,
				receiverType,
				imports,
				functionsByPackage,
				methodsByPackage,
			)
			if target != "" {
				addEdge(edges, owner, target, "calls")
			}
			return true
		})
	}
}

func resolveCall(
	expression ast.Expr,
	packageID string,
	receiverVariable string,
	receiverType string,
	imports map[string]string,
	functionsByPackage map[string]map[string]*functionRecord,
	methodsByPackage map[string]map[string]*functionRecord,
) string {
	switch call := expression.(type) {
	case *ast.Ident:
		if target := functionsByPackage[packageID][call.Name]; target != nil {
			return target.id
		}
	case *ast.SelectorExpr:
		if qualifier, ok := call.X.(*ast.Ident); ok {
			if imported := imports[qualifier.Name]; imported != "" {
				if target := functionsByPackage[imported][call.Sel.Name]; target != nil {
					return target.id
				}
			}
			if qualifier.Name == receiverVariable && receiverType != "" {
				if target := methodsByPackage[packageID][receiverType+"."+call.Sel.Name]; target != nil {
					return target.id
				}
			}
		}
	}
	return ""
}

func functionID(record *sourceRecord, fset *token.FileSet, declaration *ast.FuncDecl) string {
	label := declaration.Name.Name
	if receiver := receiverName(declaration); receiver != "" {
		label = receiver + "." + label
	}
	return fmt.Sprintf("go:%s:%d:%s", record.relPath, fset.Position(declaration.Pos()).Line, label)
}

func receiverName(function *ast.FuncDecl) string {
	if function.Recv == nil || len(function.Recv.List) == 0 {
		return ""
	}
	return expressionName(function.Recv.List[0].Type)
}

func expressionName(expression ast.Expr) string {
	switch value := expression.(type) {
	case *ast.Ident:
		return value.Name
	case *ast.StarExpr:
		return expressionName(value.X)
	case *ast.IndexExpr:
		return expressionName(value.X)
	case *ast.IndexListExpr:
		return expressionName(value.X)
	}
	return "receiver"
}

func preferredModule(records []*sourceRecord) *sourceRecord {
	for _, record := range records {
		if record.production {
			return record
		}
	}
	if len(records) > 0 {
		return records[0]
	}
	return nil
}

func makeNode(id, label, relative string, line int, kind string, production bool) graphNode {
	parts := strings.Split(relative, "/")
	group := "server"
	if len(parts) >= 2 {
		group += "/" + parts[0] + "/" + parts[1]
	} else if len(parts) == 1 {
		group += "/" + parts[0]
	}
	return graphNode{
		ID: id, Label: label, File: "apps/server/" + relative, Line: line,
		Language: "Go", Kind: kind, Subsystem: "server", Group: group,
		Production: production,
	}
}

func addEdge(edges map[string]graphEdge, source, target, kind string) {
	if source == "" || target == "" || source == target && kind == "owns" {
		return
	}
	key := source + "\x00" + target + "\x00" + kind
	edges[key] = graphEdge{Source: source, Target: target, Kind: kind}
}
