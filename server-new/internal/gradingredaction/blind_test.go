package gradingredaction

import (
	"testing"

	"github.com/google/uuid"
)

func TestBlindStudentLabel(t *testing.T) {
	if got, want := BlindStudentLabel(1), "Student 1"; got != want {
		t.Errorf("BlindStudentLabel(1) = %q, want %q", got, want)
	}
	if got, want := BlindStudentLabel(12), "Student 12"; got != want {
		t.Errorf("BlindStudentLabel(12) = %q, want %q", got, want)
	}
}

func TestShouldRedact_submissionPii(t *testing.T) {
	if ShouldRedactSubmissionPiiForStaff(false, true, false) {
		t.Fatal("expected false when feature off")
	}
	if ShouldRedactSubmissionPiiForStaff(true, false, false) {
		t.Fatal("expected false when not blind-graded")
	}
	if ShouldRedactSubmissionPiiForStaff(true, true, true) {
		t.Fatal("expected false when identities revealed")
	}
	if !ShouldRedactSubmissionPiiForStaff(true, true, false) {
		t.Fatal("expected true for active blind with identities hidden")
	}
}

func TestSubmissionRankByID(t *testing.T) {
	u1 := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	u2 := uuid.MustParse("00000000-0000-0000-0000-000000000002")
	rank := SubmissionRankByID([]uuid.UUID{u1, u2})
	if rank[u1] != 1 || rank[u2] != 2 {
		t.Fatalf("unexpected ranks: %v", rank)
	}
}
