package main

// A syntax inventory, not a native coverage proof. Keeps unidentified exits
// visible and exports bytes using production response writers for client tests.
import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/social/guild"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type site struct {
	File       string `json:"file"`
	Function   string `json:"function"`
	Line       int    `json:"line"`
	Mechanism  string `json:"mechanism"`
	Expression string `json:"expression"`
}
type packet struct {
	Writer   string `json:"writer"`
	Opcode   uint16 `json:"opcode"`
	Category int    `json:"category"`
	Code     int    `json:"code"`
	Payload  []int  `json:"payload"`
}

func numbers(p []byte) []int {
	if p == nil {
		return nil
	}
	r := make([]int, len(p))
	for i, b := range p {
		r[i] = int(b)
	}
	return r
}
func run() error {
	root := flag.String("root", "internal/game", "source root")
	out := flag.String("out", "", "inventory JSON output")
	fixtures := flag.String("fixtures", "", "packet fixture JSON output")
	check := flag.Bool("check", false, "verify outputs without overwriting")
	flag.Parse()
	writeOutput := func(path string, data []byte) error {
		data = append(data, '\n')
		if *check {
			old, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if !bytes.Equal(old, data) {
				return fmt.Errorf("stale notice artifact: %s", path)
			}
			return nil
		}
		return os.WriteFile(path, data, 0644)
	}
	var sites []site
	counts := map[string]int{}
	fs := token.NewFileSet()
	err := filepath.WalkDir(*root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		f, err := parser.ParseFile(fs, path, nil, 0)
		if err != nil {
			return err
		}
		for _, decl := range f.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				mechanism := ""
				switch x := n.(type) {
				case *ast.ReturnStmt:
					for _, v := range x.Results {
						if id, ok := v.(*ast.Ident); ok && id.Name == "false" {
							mechanism = "boolean-rejection-candidate"
						}
					}
				case *ast.CallExpr:
					var b bytes.Buffer
					_ = format.Node(&b, fs, x.Fun)
					name := strings.ToLower(b.String())
					if strings.Contains(name, "refus") {
						mechanism = "refusal-call"
					} else if strings.Contains(name, "failureresult") || strings.Contains(name, "failure") {
						mechanism = "failure-writer"
					} else if strings.Contains(name, "encode") && strings.Contains(name, "error") {
						mechanism = "error-encoder"
					}
				case *ast.KeyValueExpr:
					if id, ok := x.Key.(*ast.Ident); ok && (id.Name == "Refusal" || id.Name == "DiagnosticRefusal" || id.Name == "ErrorPayload") {
						mechanism = "refusal-field"
					}
				}
				if mechanism != "" {
					var b bytes.Buffer
					_ = format.Node(&b, fs, n)
					expression := b.String()
					if len(expression) > 700 {
						expression = expression[:700] + "..."
					}
					sites = append(sites, site{filepath.ToSlash(path), fn.Name.Name, fs.Position(n.Pos()).Line, mechanism, expression})
					counts[mechanism]++
				}
				return true
			})
		}
		return nil
	})
	if err != nil {
		return err
	}
	sort.Slice(sites, func(i, j int) bool {
		if sites[i].File != sites[j].File {
			return sites[i].File < sites[j].File
		}
		return sites[i].Line < sites[j].Line
	})
	if *out != "" {
		data, err := json.MarshalIndent(struct {
			Scope  string         `json:"scope"`
			Counts map[string]int `json:"counts"`
			Sites  []site         `json:"sites"`
		}{"Syntax candidates only: bool returns can be benign; log-only exits and indirect writers require review. No candidate is implicitly native-silent or implemented.", counts, sites}, "", "  ")
		if err != nil {
			return err
		}
		if err = writeOutput(*out, data); err != nil {
			return err
		}
	}
	if *fixtures != "" {
		var rows []packet
		writers := []struct {
			name     string
			opcode   uint16
			category int
			encode   func(uint8) []byte
		}{
			{"EncodeItemMoveError", wire.OpItemMoveResponse, 1, wire.EncodeItemMoveError},
			{"EncodeItemUseError", wire.OpItemUseResponse, 1, wire.EncodeItemUseError},
			{"EncodeMasteryLevelUpError", 0xb165, 7, wire.EncodeMasteryLevelUpError},
			{"EncodeSkillLearnError", 0xb2cb, 5, wire.EncodeSkillLearnError},
			{"EncodeGuildErrorResult", guild.OpGuildNoticeEditAck, 16, guild.EncodeGuildErrorResult},
		}
		for _, writer := range writers {
			for code := 0; code < 256; code++ {
				rows = append(rows, packet{writer.name, writer.opcode, writer.category, code, numbers(writer.encode(uint8(code)))})
			}
		}
		for reason := guild.NoticeAccepted; reason <= guild.NoticeAuthorityRejected; reason++ {
			body := guild.NoticeRefusalPayload(reason)
			code := -1
			if body != nil {
				code = int(body[1])
			}
			rows = append(rows, packet{fmt.Sprintf("NoticeRefusalPayload:%d", reason), guild.OpGuildNoticeEditAck, 16, code, numbers(body)})
		}
		data, err := json.MarshalIndent(rows, "", "  ")
		if err != nil {
			return err
		}
		if err = writeOutput(*fixtures, data); err != nil {
			return err
		}
	}
	fmt.Println(counts)
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
