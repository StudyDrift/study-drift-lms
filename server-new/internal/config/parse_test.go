package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseUint16(t *testing.T) {
	v, err := parseUint16("9")
	require.NoError(t, err)
	assert.Equal(t, uint16(9), v)
	_, err = parseUint16("")
	assert.Error(t, err)
	_, err = parseUint16("notnum")
	assert.Error(t, err)
}
