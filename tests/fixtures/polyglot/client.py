import requests


def fetch_user():
    response = requests.get("http://example.com/users/1")
    payload = response.json()
    return {"user_id": payload["user_id"], "email": payload.get("email")}
