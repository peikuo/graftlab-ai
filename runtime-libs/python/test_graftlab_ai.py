"""Tests of the graftlab_ai client against a local fake service (run: python3 -m unittest test_graftlab_ai)."""

import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

import graftlab_ai

SEEN: list = []
ANSWER: dict = {"status": 200, "body": {}}


class Fake(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        SEEN.append({"path": self.path, "auth": self.headers.get("Authorization"), "body": json.loads(self.rfile.read(length))})
        self.send_response(ANSWER["status"])
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(ANSWER["body"]).encode())

    def log_message(self, *args):
        pass


class ClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        SEEN.clear()
        os.environ["GL_AI_BASE_URL"] = f"http://127.0.0.1:{self.server.server_port}/v1/"
        os.environ["GL_AI_API_KEY"] = "test-key-value"
        os.environ["GL_AI_MODEL"] = "m1"
        ANSWER.update(status=200, body={"choices": [{"message": {"content": " hello "}}], "usage": {"prompt_tokens": 12, "completion_tokens": 3, "prompt_tokens_details": {"cached_tokens": 8}}})

    def tearDown(self):
        for k in ("GL_AI_BASE_URL", "GL_AI_API_KEY", "GL_AI_MODEL"):
            os.environ.pop(k, None)

    def test_ask_sends_the_model_and_key_and_returns_text_and_usage(self):
        r = graftlab_ai.ask("sys", "hi")
        self.assertTrue(r.ok)
        self.assertEqual(r.text, "hello")
        self.assertEqual(r.usage, {"input": 12, "cached": 8, "output": 3})
        self.assertEqual(SEEN[0]["path"], "/v1/chat/completions")
        self.assertEqual(SEEN[0]["auth"], "Bearer test-key-value")
        self.assertEqual(SEEN[0]["body"]["model"], "m1")
        self.assertEqual(SEEN[0]["body"]["messages"][0], {"role": "system", "content": "sys"})

    def test_not_configured_is_a_result_not_an_exception(self):
        os.environ.pop("GL_AI_BASE_URL")
        self.assertFalse(graftlab_ai.configured())
        r = graftlab_ai.ask("sys", "hi")
        self.assertFalse(r.ok)
        self.assertIn("not configured", r.error)
        self.assertEqual(SEEN, [])

    def test_http_error_and_unreachable_service_do_not_raise(self):
        ANSWER.update(status=500, body={"error": "secret echo"})
        r = graftlab_ai.ask("sys", "hi")
        self.assertFalse(r.ok)
        self.assertIn("500", r.error)
        self.assertNotIn("secret echo", r.error)
        os.environ["GL_AI_BASE_URL"] = "http://127.0.0.1:9/v1"
        self.assertFalse(graftlab_ai.ask("sys", "hi", timeout=2).ok)

    def test_ask_json_parses_a_fenced_answer_and_refuses_bad_json(self):
        ANSWER["body"] = {"choices": [{"message": {"content": '```json\n["a", "b"]\n```'}}]}
        self.assertEqual(graftlab_ai.ask_json("sys", "hi").data, ["a", "b"])
        ANSWER["body"] = {"choices": [{"message": {"content": "not json"}}]}
        self.assertFalse(graftlab_ai.ask_json("sys", "hi").ok)

    def test_ask_json_checks_the_answer_shape(self):
        shape = {"answer": str, "bookmark_ids": [int]}
        ANSWER["body"] = {"choices": [{"message": {"content": '{"answer": "two", "bookmark_ids": [3, 7]}'}}]}
        self.assertEqual(graftlab_ai.ask_json("s", "u", expect=shape).data["bookmark_ids"], [3, 7])
        ANSWER["body"] = {"choices": [{"message": {"content": '{"answer": "two", "ids": [3]}'}}]}
        r = graftlab_ai.ask_json("s", "u", expect=shape)
        self.assertFalse(r.ok)
        self.assertIn("bookmark_ids", r.error)
        ANSWER["body"] = {"choices": [{"message": {"content": '{"answer": "two", "bookmark_ids": ["3"]}'}}]}
        self.assertIn("whole number", graftlab_ai.ask_json("s", "u", expect=shape).error)

    def test_stub_replaces_the_service_and_records_calls(self):
        with graftlab_ai.stub(lambda messages: "stubbed") as calls:
            self.assertTrue(graftlab_ai.configured())
            self.assertEqual(graftlab_ai.ask("s", "u").text, "stubbed")
        self.assertEqual(calls[0][1]["content"], "u")
        self.assertEqual(SEEN, [])

    def test_a_failing_stub_is_a_failed_result(self):
        def boom(_):
            raise RuntimeError("down")

        with graftlab_ai.stub(boom):
            r = graftlab_ai.ask("s", "u")
        self.assertFalse(r.ok)
        self.assertEqual(r.error, "down")


if __name__ == "__main__":
    unittest.main()
