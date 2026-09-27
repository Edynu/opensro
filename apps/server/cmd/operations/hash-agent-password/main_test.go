package main

import (
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestHashPassword(t *testing.T) {
	password := []byte("correct horse battery staple")
	hash, err := hashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), password); err != nil {
		t.Fatalf("generated hash does not verify: %v", err)
	}
}

func TestHashPasswordRefusals(t *testing.T) {
	for name, password := range map[string][]byte{
		"empty":    nil,
		"too-long": []byte(strings.Repeat("x", 73)),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := hashPassword(password); err == nil {
				t.Fatal("hashPassword accepted invalid password")
			}
		})
	}
}
