//go:build windows

package store

import (
	"io"
	"os"
	"os/exec"
	"testing"

	"golang.org/x/sys/windows"
)

func TestProcessHandleAliveRejectsExitedRetainedProcessObject(t *testing.T) {
	command := exec.Command(os.Args[0], "-test.run=TestProcessHandleAliveHelperProcess")
	command.Env = append(os.Environ(), "SRO_LOCKFILE_HELPER=1")
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatalf("helper stdin: %v", err)
	}
	if err := command.Start(); err != nil {
		t.Fatalf("start helper: %v", err)
	}

	handle, err := windows.OpenProcess(
		windows.PROCESS_QUERY_LIMITED_INFORMATION,
		false,
		uint32(command.Process.Pid),
	)
	if err != nil {
		_ = stdin.Close()
		_ = command.Wait()
		t.Fatalf("retain helper process handle: %v", err)
	}
	defer func() { _ = windows.CloseHandle(handle) }()

	if !processHandleAlive(handle) {
		_ = stdin.Close()
		_ = command.Wait()
		t.Fatal("running helper reported dead")
	}
	if err := stdin.Close(); err != nil {
		t.Fatalf("release helper: %v", err)
	}
	if err := command.Wait(); err != nil {
		t.Fatalf("wait for helper exit: %v", err)
	}

	// Our handle deliberately keeps the exited process object alive. Merely
	// opening that object was the old false-positive; its exit code is the
	// authoritative liveness test.
	if processHandleAlive(handle) {
		t.Fatal("exited process object reported alive while a handle retained it")
	}
	var exitCode uint32
	if err := windows.GetExitCodeProcess(handle, &exitCode); err != nil {
		t.Fatalf("read retained process exit code: %v", err)
	}
	if exitCode == windowsStillActiveCode {
		t.Fatalf("retained process exit code = STILL_ACTIVE (%d)", exitCode)
	}
}

func TestProcessHandleAliveHelperProcess(t *testing.T) {
	if os.Getenv("SRO_LOCKFILE_HELPER") != "1" {
		return
	}
	_, _ = io.Copy(io.Discard, os.Stdin)
	os.Exit(0)
}
