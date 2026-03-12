#!/usr/bin/env python3
"""Paloma Voice — Kokoro TTS speech output.

Reads text from stdin, strips markdown formatting, and speaks it aloud
using Kokoro TTS with a British male voice (JARVIS-style).

Usage:
    echo "Hello Adam" | kokoro_env/bin/python mcp-servers/voice-speak.py
    echo "Hello Adam" | kokoro_env/bin/python mcp-servers/voice-speak.py --voice bm_george --speed 1.0
"""

# Suppress torch/HF warnings BEFORE any imports — these pollute stderr
# and cause the MCP server to report false failures.
import warnings
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)
import os
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import sys
import argparse
from io import StringIO
from markdown import Markdown
from kokoro import KPipeline
import sounddevice as sd

# --- Markdown Stripper ---
def _unmark_element(element, stream=None):
    if stream is None:
        stream = StringIO()
    if element.text:
        stream.write(element.text)
    for sub in element:
        _unmark_element(sub, stream)
    if element.tail:
        stream.write(element.tail)
    return stream.getvalue()

Markdown.output_formats["plain"] = _unmark_element
_md = Markdown(output_format="plain")
_md.stripTopLevelTags = False

def strip_markdown(text):
    _md.reset()
    return _md.convert(text)

# --- TTS Engine ---
_pipelines = {}

def get_pipeline(lang_code):
    if lang_code not in _pipelines:
        _pipelines[lang_code] = KPipeline(lang_code=lang_code)
    return _pipelines[lang_code]

def speak(text, voice='bm_george', speed=1.0, lang_code='b'):
    clean = strip_markdown(text).strip()
    if not clean:
        return

    pipeline = get_pipeline(lang_code)
    generator = pipeline(clean, voice=voice, speed=speed)

    for _, _, audio in generator:
        sd.play(audio, samplerate=24000)
        sd.wait()

# --- Main ---
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Paloma Voice — Kokoro TTS')
    parser.add_argument('--voice', default='bm_george', help='Kokoro voice name (default: bm_george)')
    parser.add_argument('--speed', type=float, default=1.0, help='Speech speed multiplier (default: 1.0)')
    parser.add_argument('--lang', default='b', help='Language code: a=American, b=British (default: b)')
    args = parser.parse_args()

    text = sys.stdin.read()
    if text.strip():
        speak(text, voice=args.voice, speed=args.speed, lang_code=args.lang)
