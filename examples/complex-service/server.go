package main

import (
  "encoding/json"
  "net/http"
)

func AuthMiddleware(next http.Handler) http.Handler { return next }
func LoggingMiddleware(next http.Handler) http.Handler { return next }
func validate() error { return nil }

type UserPayload struct {
  UserID string `json:"user_id"`
  Name string `json:"name"`
}

func HandleUser(w http.ResponseWriter, r *http.Request) {
  if err := validate(); err != nil {
    http.Error(w, "bad request", 400)
    return
  }
  payload := UserPayload{UserID: r.URL.Query().Get("id"), Name: "Alice"}
  json.NewEncoder(w).Encode(payload)
}
