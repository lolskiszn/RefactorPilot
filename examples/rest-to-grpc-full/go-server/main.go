package main

import (
  "encoding/json"
  "net/http"
)

type UserPayload struct {
  UserID string `json:"user_id"`
  Name string `json:"name"`
}

func getUser(w http.ResponseWriter, r *http.Request) {
  payload := UserPayload{UserID: "1", Name: "Alice"}
  json.NewEncoder(w).Encode(payload)
}

func main() {
  http.HandleFunc("/user", getUser)
}
