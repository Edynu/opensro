// Command hash-agent-password reads and confirms a password from the
// controlling terminal without echo, then prints the bcrypt hash accepted
// by SRO_AGENT_ACCOUNTS_PATH. Passwords are never accepted through argv.
package main

import (
	"crypto/subtle"
	"errors"
	"fmt"
	"os"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/term"
)

func main() {
	fd := int(os.Stdin.Fd())
	if !term.IsTerminal(fd) {
		fatal("stdin is not a terminal; refusing an echoing or redirected password input")
	}

	password, err := readPassword(fd, "Password: ")
	if err != nil {
		fatal("read password: %v", err)
	}
	defer clear(password)
	confirmation, err := readPassword(fd, "Confirm password: ")
	if err != nil {
		fatal("read confirmation: %v", err)
	}
	defer clear(confirmation)
	if subtle.ConstantTimeCompare(password, confirmation) != 1 {
		fatal("passwords do not match")
	}

	hash, err := hashPassword(password)
	if err != nil {
		fatal("%v", err)
	}
	fmt.Println(hash)
}

func readPassword(fd int, prompt string) ([]byte, error) {
	if _, err := fmt.Fprint(os.Stderr, prompt); err != nil {
		return nil, err
	}
	password, err := term.ReadPassword(fd)
	fmt.Fprintln(os.Stderr)
	return password, err
}

func hashPassword(password []byte) (string, error) {
	if len(password) == 0 {
		return "", errors.New("password must not be empty")
	}
	if len(password) > 72 {
		return "", errors.New("password exceeds bcrypt's 72-byte limit")
	}
	hash, err := bcrypt.GenerateFromPassword(password, bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(hash), nil
}

func fatal(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, "hash-agent-password: "+format+"\n", args...)
	os.Exit(1)
}
