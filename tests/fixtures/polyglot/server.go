package main

type UserPayload struct {
    UserID string `json:"user_id"`
    Email  string `json:"email"`
}

func GetUser() UserPayload {
    return UserPayload{}
}
