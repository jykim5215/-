from __future__ import annotations

import json
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


HOST = os.getenv("CHEOLBONG_HOST", "0.0.0.1")
PORT = int(os.getenv("CHEOLBONG_PORT", "8000"))
ROOT = Path(__file__).resolve().parent
OPENAI_MODEL = os.getenv("CHEOLBONG_VISION_MODEL", "gpt-5.4-mini")


SYSTEM_PROMPT = """
You analyze uploaded photos of outdoor pull-up bars for a location-finder website.
Return JSON only with the following keys:
- summary: object with en and ko
- confidence_label: object with en and ko
- likely_location: object with area_guess, reasoning, location_clues (array of objects with en and ko)
- environment: array of objects with en and ko
- bar_condition: object with rating and notes, each as an object with en and ko
- safety_observations: array of objects with en and ko
- possible_match_query: object with en and ko

Rules:
- Be explicit that location is an estimate unless the image proves it.
- Infer the environment around the bar from visible context such as signs, buildings, trail type, riverfront, park style, flooring, and lighting.
- Judge condition carefully: note rust, paint wear, stability concerns, weathering, crowding clues, and maintenance cues when visible.
- If location clues are weak, say that clearly in reasoning.
- Every user-facing text value must be bilingual: English in en and Korean in ko.
- Output valid JSON only, with no markdown fence.
""".strip()


def extract_response_text(response_json: dict) -> str:
    output_text = response_json.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    collected: list[str] = []
    for item in response_json.get("output", []):
        if not isinstance(item, dict):
            continue

        for content in item.get("content", []):
            if not isinstance(content, dict):
                continue

            text_value = content.get("text")
            if isinstance(text_value, dict):
                text_value = text_value.get("value") or text_value.get("text")

            if content.get("type") in {"output_text", "text"} and isinstance(text_value, str):
                collected.append(text_value)

    return "\n".join(part.strip() for part in collected if part.strip()).strip()


def request_llm_analysis(image_data_url: str, user_prompt: str) -> dict:
    openai_api_key = os.getenv("OPENAI_API_KEY")
    if not openai_api_key:
        raise RuntimeError("Set OPENAI_API_KEY before running the AI analysis server.")

    user_text = (
        "Inspect this pull-up bar photo for a website that helps users find outdoor bars. "
        "Estimate the likely location, explain visible environmental clues, assess the condition of the bar, "
        "and give practical safety observations."
    )
    if user_prompt:
        user_text = f"{user_text}\nAdditional instruction from the website user: {user_prompt}"

    payload = {
        "model": OPENAI_MODEL,
        "input": [
            {
                "role": "system",
                "content": [{"type": "input_text", "text": SYSTEM_PROMPT}],
            },
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": user_text},
                    {"type": "input_image", "image_url": image_data_url},
                ],
            },
        ],
        "max_output_tokens": 900,
    }

    request = Request(
        url="https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {openai_api_key}",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=90) as response:
            response_json = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        details = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"OpenAI request failed: {details or exc.reason}") from exc
    except URLError as exc:
        raise RuntimeError(f"OpenAI request could not be reached: {exc.reason}") from exc

    text = extract_response_text(response_json)
    if not text:
        raise RuntimeError("The model returned no text output.")

    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"The model did not return valid JSON: {text}") from exc


class CheolbongRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _send_json(self, payload: dict, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/api/analyze-image":
            self._send_json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length)
            payload = json.loads(raw_body.decode("utf-8"))
            image_data_url = str(payload.get("imageDataUrl", "")).strip()
            user_prompt = str(payload.get("userPrompt", "")).strip()

            if not image_data_url.startswith("data:image/"):
                raise ValueError("The uploaded image must be sent as a data URL.")

            analysis = request_llm_analysis(image_data_url, user_prompt)
        except json.JSONDecodeError:
            self._send_json(
                {"error": "The request body must be valid JSON."},
                status=HTTPStatus.BAD_REQUEST,
            )
            return
        except ValueError as exc:
            self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        except RuntimeError as exc:
            self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)
            return

        self._send_json({"analysis": analysis}, status=HTTPStatus.OK)

    def do_GET(self) -> None:
        if self.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def log_message(self, format: str, *args) -> None:
        return


def run() -> None:
    server = ThreadingHTTPServer((HOST, PORT), CheolbongRequestHandler)
    print(f"Cheolbong website is running at http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
