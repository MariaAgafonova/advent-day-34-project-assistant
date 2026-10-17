# Chat API fixture

Send a message with `POST /api/chat`.

Request body: `{ "content": "Hello" }`. No other fields are required.
The content limit is 2000 characters.

Success returns HTTP 200 with an `accepted` flag.
