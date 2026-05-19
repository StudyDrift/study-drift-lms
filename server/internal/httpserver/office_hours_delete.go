package httpserver

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/officehours"
)

// handleCancelBooking is DELETE /api/v1/slots/{slot_id}/book.
func (d Deps) handleCancelBooking() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		slotIDStr := chi.URLParam(r, "slot_id")
		slotID, err := uuid.Parse(slotIDStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid slot ID.")
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ctx := r.Context()

		slot, err := officehours.CancelBooking(ctx, d.Pool, slotID, userID)
		if err == officehours.ErrNotBookedByStudent {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have an active booking for this slot.")
			return
		}
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to cancel booking.")
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(slot)
	}
}
