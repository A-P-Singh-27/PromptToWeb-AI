import argparse
import json
import os
import subprocess
import sys
import threading
import time
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

# Parse arguments
parser = argparse.ArgumentParser(description="Cursor AI Local Agent Engine")
parser.add_argument("--prompt", type=str, default=None, help="Dynamic prompt to run programmatically")
parser.add_argument("--session", type=str, default=None, help="Session ID for workspace isolation")
parser.add_argument("--model", type=str, default=None, help="Specific Gemini model to target")
parser.add_argument("--json-stream", action="store_true", help="Stream JSON lines to stdout for IPC / Express API")
args = parser.parse_args()

# Workspace setup
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if args.session:
    WORKSPACE_DIR = os.path.abspath(os.path.join(BASE_DIR, "workspace", args.session))
else:
    WORKSPACE_DIR = os.path.join(BASE_DIR, "workspace")
os.makedirs(WORKSPACE_DIR, exist_ok=True)

# Client configuration
client = OpenAI(
    api_key=os.getenv("GEMINI_API_KEY"),
    base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
)

BASE_FALLBACK_MODELS = ["gemini-3.5-flash"]
if args.model and args.model.strip():
    target_m = args.model.strip()
    DEFAULT_MODELS = [target_m] + [m for m in BASE_FALLBACK_MODELS if m != target_m]
else:
    DEFAULT_MODELS = BASE_FALLBACK_MODELS


def emit_event(event_type: str, payload: dict):
    """Helper to emit formatted JSON stream events to stdout for IPC integration."""
    event = {"type": event_type, "timestamp": time.time(), **payload}
    if args.json_stream:
        sys.stdout.write(json.dumps(event) + "\n")
        sys.stdout.flush()


class CLIStatusSpinner:
    """Interactive CLI status spinner for interactive mode."""
    def __init__(self):
        self.message = ""
        self.running = False
        self.thread = None
        self.frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

    def _spin(self):
        idx = 0
        while self.running:
            frame = self.frames[idx % len(self.frames)]
            sys.stdout.write(f"\r⏳ {self.message} {frame}   ")
            sys.stdout.flush()
            idx += 1
            time.sleep(0.08)

    def start(self, message: str, state: str = "thinking"):
        if args.json_stream:
            emit_event("status", {"state": state, "message": message})
            return
        self.stop()
        self.message = message
        self.running = True
        self.thread = threading.Thread(target=self._spin, daemon=True)
        self.thread.start()

    def update(self, message: str, state: str = "thinking"):
        if args.json_stream:
            emit_event("status", {"state": state, "message": message})
            return
        self.message = message

    def stop(self, print_line: str = None):
        if self.running:
            self.running = False
            if self.thread and self.thread.is_alive():
                self.thread.join(timeout=0.2)
            sys.stdout.write("\r" + " " * 90 + "\r")
            sys.stdout.flush()
        if print_line and not args.json_stream:
            print(print_line)


spinner = CLIStatusSpinner()


def get_completion_with_retry(messages, max_retries=3):
    last_exception = None
    for model in DEFAULT_MODELS:
        spinner.start(f"🧠 Brain Thinking: Analyzing request with model '{model}'...", state="thinking")
        for attempt in range(max_retries):
            try:
                response = client.chat.completions.create(
                    model=model,
                    response_format={"type": "json_object"},
                    messages=messages
                )
                spinner.stop()
                return response
            except Exception as e:
                err_str = str(e)
                last_exception = e
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    wait_time = (attempt + 1) * 3
                    spinner.update(f"Free tier limit hit on '{model}'. Waiting {wait_time}s (Retry {attempt+1}/{max_retries})...", state="rate_limit")
                    time.sleep(wait_time)
                elif "404" in err_str or "NOT_FOUND" in err_str:
                    spinner.update(f"Model '{model}' unavailable. Switching to alternative model...", state="fallback")
                    time.sleep(1)
                    break
                else:
                    spinner.stop()
                    raise e
    spinner.stop()
    raise Exception(f"Quota error on models. Google AI Studio Free Tier allows 15 requests/min. Error details: {last_exception}")


def write_file(filepath: str, content: str) -> str:
    """Creates parent directories if necessary and writes content to a file inside the workspace directory."""
    try:
        if os.path.isabs(filepath):
            target_path = filepath
        else:
            target_path = os.path.abspath(os.path.join(WORKSPACE_DIR, filepath))

        os.makedirs(os.path.dirname(target_path), exist_ok=True)

        with open(target_path, "w", encoding="utf-8") as f:
            f.write(content)

        rel_path = os.path.relpath(target_path, WORKSPACE_DIR)
        line_count = len(content.splitlines())
        emit_event("file_created", {"filepath": rel_path, "lines": line_count})
        return f"File '{rel_path}' successfully created/updated in workspace ({line_count} lines)."
    except Exception as e:
        return f"Error writing file '{filepath}': {str(e)}"


def read_file(filepath: str) -> str:
    """Reads content from a file inside the workspace directory."""
    try:
        if os.path.isabs(filepath):
            target_path = filepath
        else:
            target_path = os.path.abspath(os.path.join(WORKSPACE_DIR, filepath))

        if not os.path.exists(target_path):
            return f"Error: File '{filepath}' does not exist in workspace."

        with open(target_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        return f"Error reading file '{filepath}': {str(e)}"


def list_dir(directory: str = ".") -> str:
    """Lists files and folders inside the workspace directory."""
    try:
        if os.path.isabs(directory):
            target_path = directory
        else:
            target_path = os.path.abspath(os.path.join(WORKSPACE_DIR, directory))

        if not os.path.exists(target_path):
            return f"Error: Directory '{directory}' does not exist."

        items = os.listdir(target_path)
        return json.dumps(items, indent=2)
    except Exception as e:
        return f"Error listing directory '{directory}': {str(e)}"


def run_command(command: str) -> str:
    """Executes a system shell command inside the workspace directory."""
    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=WORKSPACE_DIR,
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            return result.stdout if result.stdout.strip() else "Command executed successfully with no output."
        return f"Command Error (Exit Code {result.returncode}):\n{result.stderr}\n{result.stdout}"
    except Exception as e:
        return f"Exception executing command: {str(e)}"


available_tools = {
    "write_file": {
        "fn": write_file,
        "description": "Writes text content to a file in workspace. Input: {\"filepath\": \"filename\", \"content\": \"text\"}"
    },
    "read_file": {
        "fn": read_file,
        "description": "Reads text content from a file in workspace. Input: {\"filepath\": \"filename\"}"
    },
    "list_dir": {
        "fn": list_dir,
        "description": "Lists directory content in workspace. Input: {\"directory\": \".\"}"
    },
    "run_command": {
        "fn": run_command,
        "description": "Runs shell command inside workspace. Input: {\"command\": \"dir\"} or string"
    }
}

system_prompt = f"""
You are an expert AI Coding Agent specialized in building web applications and software projects locally.
You operate in an autonomous loop: plan -> action -> observe -> output.

Environment & Setup:
- Operating System: Windows
- Default Workspace Path: {WORKSPACE_DIR}
- All generated code files MUST be written into the `workspace` directory using the `write_file` tool.

Guidelines for Web Projects (HTML, CSS, JS):
1. Create modern, beautiful, responsive, accessible, and error-free applications.
2. Modularize files clearly:
   - `index.html` (Semantic structure, UTF-8 charset, viewport meta tag, linked CSS/JS).
   - `style.css` (Clean CSS with color variables, flex/grid layouts, hover effects, mobile media queries).
   - `app.js` (Robust JavaScript with event listeners, state management, full CRUD operations, and `localStorage` persistence).
3. When writing code via `write_file`, provide COMPLETE code without placeholders, comments like '// rest of code...', or truncation.

JSON Output Rules:
Respond STRICTLY with a single valid JSON object adhering to one of these formats:

Plan step:
{{
    "step": "plan",
    "content": "Step-by-step description of what you plan to do"
}}

Action step:
{{
    "step": "action",
    "function": "write_file",
    "input": {{
        "filepath": "index.html",
        "content": "<!DOCTYPE html>..."
    }}
}}

Output step (when finished):
{{
    "step": "output",
    "content": "User summary message explaining the created application, file locations in workspace, and how to view it."
}}

Available Tools:
- write_file: Write file content. Input: {{"filepath": "index.html", "content": "..."}}
- read_file: Read file. Input: {{"filepath": "index.html"}}
- list_dir: List files. Input: {{"directory": "."}}
- run_command: Run shell command. Input: {{"command": "dir"}}
"""


def process_query(user_query: str):
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_query}
    ]

    while True:
        response = get_completion_with_retry(messages)
        raw_content = response.choices[0].message.content

        try:
            parsed_output = json.loads(raw_content)
        except json.JSONDecodeError:
            spinner.stop()
            if not args.json_stream:
                print("⚠️ Non-JSON response received. Retrying with prompt reminder...")
            messages.append({
                "role": "user",
                "content": "Your previous output was not valid JSON. Please reply strictly in JSON format."
            })
            continue

        step = parsed_output.get("step")

        if step == "plan":
            plan_content = parsed_output.get('content')
            emit_event("plan", {
                "state": "planning", 
                "content": plan_content,
                "message": f"📋 Planning Architecture: {plan_content[:100]}..."
            })
            if not args.json_stream:
                print(f"🧠 Plan: {plan_content}")
            messages.append({"role": "assistant", "content": json.dumps(parsed_output)})
            continue

        if step == "action":
            tool_name = parsed_output.get("function")
            tool_input = parsed_output.get("input")

            # Determine file type and state message for animated progress
            state = "executing"
            state_msg = f"⚙️ Executing tool '{tool_name}'..."
            target_fname = "file"

            if tool_name == "write_file":
                target_fname = tool_input.get("filepath", "file") if isinstance(tool_input, dict) else "file"
                if target_fname.endswith(".js"):
                    state = "writing_js"
                    state_msg = f"✏️ Writing JavaScript Logic: Crafting workspace/{target_fname} (CRUD & interactivity)..."
                elif target_fname.endswith(".html"):
                    state = "writing_html"
                    state_msg = f"📝 Writing HTML Structure: Crafting workspace/{target_fname} (UI markup & layout)..."
                elif target_fname.endswith(".css"):
                    state = "writing_css"
                    state_msg = f"🎨 Writing CSS Styling: Crafting workspace/{target_fname} (styling & responsive design)..."
                else:
                    state = "writing_file"
                    state_msg = f"✏️ Writing File: Crafting workspace/{target_fname}..."

            spinner.start(state_msg, state=state)
            emit_event("action", {
                "state": state, 
                "function": tool_name, 
                "input": tool_input, 
                "message": state_msg,
                "targetFile": target_fname
            })
            messages.append({"role": "assistant", "content": json.dumps(parsed_output)})

            if tool_name in available_tools:
                fn = available_tools[tool_name]["fn"]
                try:
                    if isinstance(tool_input, dict):
                        obs_output = fn(**tool_input)
                    elif isinstance(tool_input, str):
                        obs_output = fn(tool_input)
                    elif tool_input is None:
                        obs_output = fn()
                    else:
                        obs_output = fn(tool_input)
                except Exception as e:
                    obs_output = f"Error executing tool '{tool_name}': {str(e)}"
            else:
                obs_output = f"Error: Tool '{tool_name}' does not exist."

            spinner.stop(f"📄 Action Completed: {obs_output}")
            emit_event("observation", {"output": obs_output})

            messages.append({"role": "assistant", "content": json.dumps({"step": "observe", "output": obs_output})})
            continue

        if step == "output":
            spinner.stop()
            output_text = parsed_output.get('content')
            emit_event("output", {
                "state": "completed",
                "content": output_text,
                "message": "🎉 Build Completed: All application files generated and ready!"
            })
            if not args.json_stream:
                print(f"\n🎉 Build Finished!")
                print(f"🤖 Agent Output:\n{output_text}\n")
            break


def main():
    if args.prompt:
        # Programmatic execution mode
        process_query(args.prompt)
        return

    # Interactive CLI mode
    print(f"==================================================")
    print(f"🚀 Local Cursor AI Agent Initialized")
    print(f"📁 Target Workspace: {WORKSPACE_DIR}")
    print(f"==================================================\n")

    while True:
        try:
            user_query = input("📝 Enter your app prompt (e.g. 'Build a weather app') [or 'exit']: ").strip()
            if not user_query:
                continue
            if user_query.lower() in ["exit", "quit"]:
                print("Goodbye! 👋")
                break
            process_query(user_query)
        except KeyboardInterrupt:
            spinner.stop()
            print("\nSession interrupted. Exiting...")
            break
        except Exception as e:
            spinner.stop()
            print(f"❌ An error occurred: {str(e)}")


if __name__ == "__main__":
    main()
