package httpserver

import (
	"encoding/json"
	"os"
	"time"
)

// #region agent log
const canvasAgentDebugSessionID = "054d1d"

// canvasAgentDebugLogPath is workspace-local NDJSON for Cursor debug mode (no PII/secrets in data).
const canvasAgentDebugLogPath = "/Users/willdech/Documents/lextures/.cursor/debug-054d1d.log"

func canvasAgentDebugLog(runID, hypothesisID, location, message string, data map[string]any) {
	payload := map[string]any{
		"sessionId":    canvasAgentDebugSessionID,
		"timestamp":    time.Now().UnixMilli(),
		"runId":        runID,
		"hypothesisId": hypothesisID,
		"location":     location,
		"message":      message,
		"data":         data,
	}
	buf, err := json.Marshal(payload)
	if err != nil {
		return
	}
	buf = append(buf, '\n')
	f, err := os.OpenFile(canvasAgentDebugLogPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return
	}
	_, _ = f.Write(buf)
	_ = f.Close()
}

// #endregion agent log
