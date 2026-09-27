package gamedata

import (
	"bufio"
	"compress/gzip"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

const (
	archiveMagic        = "SROGDB1\n"
	EnvCacheRoot        = "SRO_SERVER_GAME_DATA_CACHE_ROOT"
	maxArchivePathBytes = 4096
)

func materializeArchive(filename string) (string, error) {
	absolute, err := filepath.Abs(filename)
	if err != nil {
		return "", fmt.Errorf("resolve archive: %w", err)
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return filepath.Clean(absolute), nil
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("game-data root %q is neither a directory nor a regular archive", absolute)
	}

	digest, err := fileSHA256(absolute)
	if err != nil {
		return "", fmt.Errorf("hash archive: %w", err)
	}
	cacheRoot := strings.TrimSpace(os.Getenv(EnvCacheRoot))
	if cacheRoot == "" {
		cacheRoot = filepath.Join(filepath.Dir(absolute), ".game-data-cache")
	}
	cacheRoot, err = filepath.Abs(cacheRoot)
	if err != nil {
		return "", fmt.Errorf("resolve game-data cache: %w", err)
	}
	if err := os.MkdirAll(cacheRoot, 0o700); err != nil {
		return "", fmt.Errorf("create game-data cache: %w", err)
	}
	target := filepath.Join(cacheRoot, digest)
	if info, statErr := os.Stat(filepath.Join(target, ManifestFilename)); statErr == nil && info.Mode().IsRegular() {
		return target, nil
	}

	temporary, err := os.MkdirTemp(cacheRoot, ".extract-")
	if err != nil {
		return "", fmt.Errorf("create extraction directory: %w", err)
	}
	keepTemporary := false
	defer func() {
		if !keepTemporary {
			_ = os.RemoveAll(temporary)
		}
	}()
	if err := extractArchive(absolute, temporary); err != nil {
		return "", err
	}
	if err := os.Rename(temporary, target); err != nil {
		if info, statErr := os.Stat(filepath.Join(target, ManifestFilename)); statErr != nil || !info.Mode().IsRegular() {
			return "", fmt.Errorf("publish extracted game data: %w", err)
		}
		return target, nil
	}
	keepTemporary = true
	return target, nil
}

func extractArchive(filename, target string) error {
	file, err := os.Open(filename)
	if err != nil {
		return fmt.Errorf("open game-data archive: %w", err)
	}
	defer func() { _ = file.Close() }()
	gzipReader, err := gzip.NewReader(bufio.NewReader(file))
	if err != nil {
		return fmt.Errorf("open game-data gzip stream: %w", err)
	}
	defer func() { _ = gzipReader.Close() }()

	magic := make([]byte, len(archiveMagic))
	if _, err := io.ReadFull(gzipReader, magic); err != nil || string(magic) != archiveMagic {
		return fmt.Errorf("game-data archive magic is invalid")
	}
	var countBytes [4]byte
	if _, err := io.ReadFull(gzipReader, countBytes[:]); err != nil {
		return fmt.Errorf("read game-data archive file count: %w", err)
	}
	count := binary.LittleEndian.Uint32(countBytes[:])
	if count == 0 || count > maxBundleFiles {
		return fmt.Errorf("game-data archive file count %d is invalid", count)
	}

	seen := make(map[string]struct{}, count)
	var total int64
	for index := uint32(0); index < count; index++ {
		var header [12]byte
		if _, err := io.ReadFull(gzipReader, header[:]); err != nil {
			return fmt.Errorf("read archive record %d header: %w", index, err)
		}
		pathLength := binary.LittleEndian.Uint32(header[:4])
		size := binary.LittleEndian.Uint64(header[4:])
		if pathLength == 0 || pathLength > maxArchivePathBytes || size > uint64(maxBundleBytes-total) {
			return fmt.Errorf("archive record %d has invalid path length or size", index)
		}
		pathBytes := make([]byte, pathLength)
		if _, err := io.ReadFull(gzipReader, pathBytes); err != nil {
			return fmt.Errorf("read archive record %d path: %w", index, err)
		}
		relativePath := string(pathBytes)
		folded := strings.ToLower(relativePath)
		if !fs.ValidPath(relativePath) || relativePath == "." || strings.Contains(relativePath, "\\") {
			return fmt.Errorf("archive record %d path %q is unsafe", index, relativePath)
		}
		if _, duplicate := seen[folded]; duplicate {
			return fmt.Errorf("archive record %d duplicates path %q", index, relativePath)
		}
		seen[folded] = struct{}{}
		total += int64(size)

		destination := filepath.Join(target, filepath.FromSlash(relativePath))
		if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
			return fmt.Errorf("create archive directory for %s: %w", relativePath, err)
		}
		output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			return fmt.Errorf("create archive file %s: %w", relativePath, err)
		}
		written, copyErr := io.CopyN(output, gzipReader, int64(size))
		closeErr := output.Close()
		if copyErr != nil || written != int64(size) {
			return fmt.Errorf("extract archive file %s: wrote %d/%d: %w", relativePath, written, size, copyErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close archive file %s: %w", relativePath, closeErr)
		}
	}
	var trailing [1]byte
	if read, err := gzipReader.Read(trailing[:]); read != 0 || !errors.Is(err, io.EOF) {
		return fmt.Errorf("game-data archive has trailing or unreadable data")
	}
	return nil
}

func fileSHA256(filename string) (string, error) {
	file, err := os.Open(filename)
	if err != nil {
		return "", err
	}
	defer func() { _ = file.Close() }()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}
