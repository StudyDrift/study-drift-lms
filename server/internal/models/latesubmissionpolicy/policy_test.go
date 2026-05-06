package latesubmissionpolicy

import "testing"

func ptr(i int32) *int32 { return &i }

func TestValidateLateSubmissionPolicyPair(t *testing.T) {
	cases := []struct {
		name    string
		policy  string
		percent *int32
		wantErr bool
	}{
		{"allow_no_pct", "allow", nil, false},
		{"allow_with_pct_ok", "allow", ptr(50), false},
		{"block_no_pct", "block", nil, false},
		{"penalty_no_pct", "penalty", nil, true},
		{"penalty_pct_zero", "penalty", ptr(0), false},
		{"penalty_pct_50", "penalty", ptr(50), false},
		{"penalty_pct_100", "penalty", ptr(100), false},
		{"penalty_pct_neg", "penalty", ptr(-1), true},
		{"penalty_pct_over", "penalty", ptr(101), true},
		{"unknown", "lol", nil, true},
		{"empty", "", nil, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidateLateSubmissionPolicyPair(c.policy, c.percent)
			if (err != nil) != c.wantErr {
				t.Fatalf("err = %v, wantErr = %v", err, c.wantErr)
			}
		})
	}
}

func TestLateSubmissionPolicies(t *testing.T) {
	if len(LateSubmissionPolicies) != 3 {
		t.Fatalf("expected 3 policies, got %d", len(LateSubmissionPolicies))
	}
}
