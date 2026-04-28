package irtcalibration

import (
	"testing"

	"github.com/google/uuid"
)

func TestRunInBackground_NilPool(t *testing.T) {
	RunInBackground(nil, uuid.New(), nil) // no panic
}
