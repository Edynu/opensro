package store

import (
	"errors"
	"testing"
	"time"

	"opensro.online/server/internal/domain"
)

func TestReadDoorsOverlapAndExcludeWrites(t *testing.T) {
	authority, err := Open(t.TempDir(), Options{})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer authority.Close()

	firstEntered := make(chan struct{})
	releaseFirst := make(chan struct{})
	firstDone := make(chan struct{})
	go func() {
		authority.ReadCharacters(testDivision, func([]*domain.Character) {
			close(firstEntered)
			<-releaseFirst
		})
		close(firstDone)
	}()
	<-firstEntered

	secondEntered := make(chan struct{})
	go authority.ReadCharacters(testDivision, func([]*domain.Character) {
		close(secondEntered)
	})
	select {
	case <-secondEntered:
	case <-time.After(time.Second):
		t.Fatal("a read-only door blocked behind another reader")
	}

	writerStarted := make(chan struct{})
	writerEntered := make(chan struct{})
	go func() {
		close(writerStarted)
		authority.Mutate("read-exclusion-test", func() {
			close(writerEntered)
		})
	}()
	<-writerStarted
	select {
	case <-writerEntered:
		t.Fatal("write door entered while a reader still held the authority")
	case <-time.After(25 * time.Millisecond):
	}

	close(releaseFirst)
	select {
	case <-firstDone:
	case <-time.After(time.Second):
		t.Fatal("first read door did not return")
	}
	select {
	case <-writerEntered:
	case <-time.After(time.Second):
		t.Fatal("write door did not enter after readers returned")
	}
}

func TestUpdateCharacterRefusalSkipsCommit(t *testing.T) {
	authority, err := Open(t.TempDir(), Options{DefaultSkills: testSkillSeeder})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer authority.Close()

	character := seededCharacter()
	if err := authority.CreateCharacter(testDivision, "test-account", character); err != nil {
		t.Fatalf("CreateCharacter: %v", err)
	}
	authority.FailCommits(errors.New("commit attempted"))

	if authority.UpdateCharacter(character, "refused-operation", func() bool {
		return false
	}) {
		t.Fatal("refused update reported a change")
	}
	if health := authority.Health(); health.FailedWrites != 0 {
		t.Fatalf("refused update attempted persistence: %+v", health)
	}

	if !authority.UpdateCharacter(character, "accepted-operation", func() bool {
		value := int64(1234)
		character.Gold = &value
		return true
	}) {
		t.Fatal("accepted update reported no change")
	}
	if health := authority.Health(); health.FailedWrites != 1 {
		t.Fatalf("accepted update did not attempt exactly one commit: %+v", health)
	}
}
