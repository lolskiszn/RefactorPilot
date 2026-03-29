export interface UserPayload {
  user_id: string;
}

export async function fetchUser() {
  const response = await fetch("/api/user");
  const data = await response.json();
  return data.user_id;
}
