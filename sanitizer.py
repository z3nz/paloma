import sys
import time
import subprocess
from markdown import Markdown
from io import StringIO
from kokoro import KPipeline
import sounddevice as sd

# --- 1. Markdown Sanitizer ---
def unmark_element(element, stream=None):
    if stream is None:
        stream = StringIO()
    if element.text:
        stream.write(element.text)
    for sub in element:
        unmark_element(sub, stream)
    if element.tail:
        stream.write(element.tail)
    return stream.getvalue()

Markdown.output_formats["plain"] = unmark_element
__md = Markdown(output_format="plain")
__md.stripTopLevelTags = False

def unmark(text):
    return __md.convert(text)

# --- 2. Kokoro TTS Engine ---
# Initializing pipeline silently
pipeline = KPipeline(lang_code='a') 

def speak_summary(markdown_text):
    clean_text = unmark(markdown_text).strip()
    if not clean_text:
        return
    print(f"\nSpeaking: {clean_text[:60]}...")
    generator = pipeline(clean_text, voice='af_heart', speed=1)
    
    for i, (gs, ps, audio) in enumerate(generator):
        sd.play(audio, samplerate=24000)
        sd.wait()

# --- 3. Universal Input Handlers ---
def get_wsl_clipboard():
    """Reads the Windows 11 clipboard seamlessly from inside WSL 2."""
    try:
        # Calls Windows PowerShell to securely fetch clipboard text
        result = subprocess.check_output(
            ['powershell.exe', '-NoProfile', '-Command', 'Get-Clipboard']
        ).decode('utf-8').strip()
        return result
    except Exception:
        return ""

def monitor_clipboard():
    print("Listening to your Windows clipboard... Copy any text to hear it!")
    last_text = get_wsl_clipboard()
    while True:
        time.sleep(1) # Check the clipboard every 1 second
        current_text = get_wsl_clipboard()
        if current_text and current_text!= last_text:
            speak_summary(current_text)
            last_text = current_text

if __name__ == "__main__":
    # MODE A: If text is piped from the terminal (e.g., from Claude Code)
    if not sys.stdin.isatty():
        piped_text = sys.stdin.read()
        speak_summary(piped_text)
    # MODE B: If run normally, monitor the Windows clipboard continuously
    else:
        monitor_clipboard()