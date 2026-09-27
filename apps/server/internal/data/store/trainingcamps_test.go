package store

import (
	"reflect"
	"testing"
	"time"

	"opensro.online/server/internal/domain"
)

func TestTrainingCampNoticeAuthorityAndPersistence(t *testing.T) {
	t.Parallel()
	dir, clock := t.TempDir(), newTestClock()
	s := openTest(t, dir, clock)
	master, student, outsider := guildTestCharacter("noticemaster"), guildTestCharacter("notestudent"), guildTestCharacter("noteoutsider")
	for _, c := range []*domain.Character{master, student, outsider} {
		if err := s.CreateCharacter(testDivision, "test-account", c); err != nil {
			t.Fatal(err)
		}
	}
	a, ok := s.TrainingCamps().AdmitStudent(testDivision, domain.TrainingCampAdmission{MasterCharID: master.ID, StudentCharID: student.ID, MasterMinLevel: 1, StudentMaxLevel: 140, StudentLimit: 5})
	if !ok {
		t.Fatal("admission failed")
	}
	for _, request := range []struct {
		division     string
		author, camp int64
	}{{testDivision, student.ID, a.Camp.ID}, {testDivision, outsider.ID, a.Camp.ID}, {testDivision, master.ID, a.Camp.ID + 1}, {"other", master.ID, a.Camp.ID}} {
		if _, _, ok := s.TrainingCamps().UpdateNotice(request.division, request.author, request.camp, "unauthorized", "text"); ok {
			t.Fatalf("accepted %+v", request)
		}
	}
	unchanged, _, _ := s.TrainingCamps().Camp(testDivision, a.Camp.ID)
	if unchanged != a.Camp {
		t.Fatal("refusals changed camp")
	}
	camp, members, ok := s.TrainingCamps().UpdateNotice(testDivision, master.ID, a.Camp.ID, "Welcome", "Meet at the gate.\nRésumé")
	if !ok || camp.Subject != "Welcome" || camp.Contents != "Meet at the gate.\nRésumé" || !reflect.DeepEqual(members, a.Members) {
		t.Fatalf("update: %+v %+v %v", camp, members, ok)
	}
	members[0].Kind = 2
	_, live, _ := s.TrainingCamps().Camp(testDivision, a.Camp.ID)
	if !reflect.DeepEqual(live, a.Members) {
		t.Fatal("returned members alias authority")
	}
	s.MutateCharacter(master, "test-delete-pending", func() { master.DeletePending = true })
	if _, _, ok := s.TrainingCamps().UpdateNotice(testDivision, master.ID, a.Camp.ID, "bad", "bad"); ok {
		t.Fatal("delete-pending author accepted")
	}
	s.MutateCharacter(master, "test-restore", func() { master.DeletePending = false })
	s.MutateCharacter(master, "test-notice-death-race", func() { hp := int64(0); master.CurrentHP = &hp })
	if _, _, ok := s.TrainingCamps().UpdateNotice(testDivision, master.ID, a.Camp.ID, "bad", "bad"); ok {
		t.Fatal("dead author committed a notice")
	}
	s.MutateCharacter(master, "test-notice-revive", func() { master.CurrentHP = nil })
	s.Close()
	reopened := openTest(t, dir, clock)
	stored, storedMembers, ok := reopened.TrainingCamps().Camp(testDivision, a.Camp.ID)
	if !ok || stored != camp || !reflect.DeepEqual(storedMembers, a.Members) {
		t.Fatalf("reopened: %+v %+v %v", stored, storedMembers, ok)
	}
}

func TestTrainingCampDeletionInvariant(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	clock := newTestClock()
	s := openTest(t, dir, clock)

	master := guildTestCharacter("campmaster")
	student := guildTestCharacter("campstudent")
	outsider := guildTestCharacter("campoutside")
	for _, c := range []*domain.Character{master, student, outsider} {
		if err := s.CreateCharacter(testDivision, "test-account", c); err != nil {
			t.Fatal(err)
		}
	}
	admission, ok := s.TrainingCamps().AdmitStudent(testDivision, domain.TrainingCampAdmission{
		MasterCharID:    master.ID,
		StudentCharID:   student.ID,
		MasterMinLevel:  1,
		StudentMaxLevel: 140,
		StudentLimit:    5,
	})
	if !ok {
		t.Fatal("initial student admission refused")
	}
	camp := admission.Camp

	stamp := clock.Now().UTC().Format(time.RFC3339)
	if s.ReserveCharacterDeletion(student, stamp) {
		t.Fatal("training-camp member entered delete-pending state")
	}
	if student.DeletePending {
		t.Fatal("refused reservation mutated the student")
	}
	if !s.ReserveCharacterDeletion(outsider, stamp) {
		t.Fatal("guildless/campless character reservation refused")
	}
	if _, admitted := s.TrainingCamps().AdmitStudent(testDivision, domain.TrainingCampAdmission{
		MasterCharID:    master.ID,
		StudentCharID:   outsider.ID,
		ExpectedCampID:  camp.ID,
		MasterMinLevel:  1,
		StudentMaxLevel: 140,
		StudentLimit:    5,
	}); admitted {
		t.Fatal("delete-pending character joined a training camp")
	}
	s.MutateCharacter(outsider, "delete-restore", func() {
		outsider.DeletePending = false
		outsider.DeleteReservedAt = ""
	})

	// Simulate an impossible pre-invariant record and prove the reaper does
	// not turn it into a dangling MasterCharID.
	s.MutateCharacter(master, "invalid-delete-reserve", func() {
		master.DeletePending = true
		master.DeleteReservedAt = stamp
	})
	clock.Advance(DeleteReservationWindow + time.Hour)
	if reaped := s.ReapMaturedDeletions(); len(reaped) != 0 {
		t.Fatalf("reaped training-camp master(s) %v, want fail-closed none", reaped)
	}
	if gotCamp, gotMembers, ok := s.TrainingCamps().Camp(testDivision, camp.ID); !ok ||
		gotCamp.MasterCharID != master.ID || len(gotMembers) != 2 {
		t.Fatalf("camp after refused reap = %+v members=%+v ok=%v", gotCamp, gotMembers, ok)
	}
	s.MutateCharacter(master, "restore-impossible-reservation", func() {
		master.DeletePending = false
		master.DeleteReservedAt = ""
	})
	s.Close()

	s2 := openTest(t, dir, clock)
	if gotCamp, gotMembers, ok := s2.TrainingCamps().Camp(testDivision, camp.ID); !ok ||
		gotCamp.MasterCharID != master.ID || len(gotMembers) != 2 {
		t.Fatalf("reopened camp = %+v members=%+v ok=%v", gotCamp, gotMembers, ok)
	}
	if got := len(s2.Characters().CharactersForDivision(testDivision)); got != 3 {
		t.Fatalf("reopened live characters = %d, want 3", got)
	}
}

func TestTrainingCampAdmissionRefusesInvalidAggregateCommands(t *testing.T) {
	t.Parallel()
	s := openTest(t, t.TempDir(), newTestClock())
	master := guildTestCharacter("campvalid")
	student := guildTestCharacter("studentvalid")
	for _, character := range []*domain.Character{master, student} {
		if err := s.CreateCharacter(testDivision, "test-account", character); err != nil {
			t.Fatal(err)
		}
	}

	cases := []struct {
		name      string
		admission domain.TrainingCampAdmission
	}{
		{"unknown student", domain.TrainingCampAdmission{MasterCharID: master.ID, StudentCharID: 999, MasterMinLevel: 1, StudentMaxLevel: 140, StudentLimit: 5}},
		{"self admission", domain.TrainingCampAdmission{MasterCharID: master.ID, StudentCharID: master.ID, MasterMinLevel: 1, StudentMaxLevel: 140, StudentLimit: 5}},
		{"invalid master floor", domain.TrainingCampAdmission{MasterCharID: master.ID, StudentCharID: student.ID, MasterMinLevel: 0, StudentMaxLevel: 140, StudentLimit: 5}},
		{"invalid student ceiling", domain.TrainingCampAdmission{MasterCharID: master.ID, StudentCharID: student.ID, MasterMinLevel: 1, StudentMaxLevel: 0, StudentLimit: 5}},
		{"invalid student limit", domain.TrainingCampAdmission{MasterCharID: master.ID, StudentCharID: student.ID, MasterMinLevel: 1, StudentMaxLevel: 140, StudentLimit: 8}},
		{"stale existing camp", domain.TrainingCampAdmission{MasterCharID: master.ID, StudentCharID: student.ID, ExpectedCampID: master.ID + 99, MasterMinLevel: 1, StudentMaxLevel: 140, StudentLimit: 5}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, ok := s.TrainingCamps().AdmitStudent(testDivision, tc.admission); ok {
				t.Fatal("invalid training-camp admission accepted")
			}
		})
	}
}
