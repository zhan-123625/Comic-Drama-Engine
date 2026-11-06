# -*- coding: utf-8 -*-
"""
DashScope TTS bridge script.
Synthesizes speech using DashScope Sambert or CosyVoice models.
Supports CosyVoice-v2 high-expressive emotional neural voices with auto-retry and smooth fallback.
"""
import argparse
import os
import sys
import time

def main():
    parser = argparse.ArgumentParser(description="DashScope TTS Bridge")
    parser.add_argument("--api-key", required=True, help="DashScope API Key")
    parser.add_argument("--text", help="Text to synthesize")
    parser.add_argument("--text-file", help="Path to file containing text to synthesize (UTF-8)")
    parser.add_argument("--model", default="cosyvoice-v2:longxiaochun_v2", help="TTS Model (e.g. cosyvoice-v2:longxiaochun_v2, sambert-zhiwei-v1)")
    parser.add_argument("--voice", default=None, help="Voice name (for cosyvoice)")
    parser.add_argument("--output", required=True, help="Output mp3 file path")

    args = parser.parse_args()

    text = args.text
    if args.text_file and os.path.isfile(args.text_file):
        with open(args.text_file, "r", encoding="utf-8") as f:
            text = f.read().strip()

    if not text:
        sys.stderr.write("Error: text is empty\n")
        sys.exit(1)

    try:
        import dashscope
        dashscope.api_key = args.api_key

        raw_model = (args.model or "cosyvoice-v2:longxiaochun_v2").strip()
        voice = (args.voice or "").strip() or None

        # 支持形如 "cosyvoice-v2:longxiaochun_v2" 简写格式
        if ":" in raw_model:
            parts = raw_model.split(":", 1)
            model = parts[0].strip()
            if not voice:
                voice = parts[1].strip()
        else:
            model = raw_model

        audio_data = None
        last_error = None

        if model.startswith("cosyvoice"):
            actual_model = "cosyvoice-v2" if model == "cosyvoice" or model == "cosyvoice-v2" else model
            actual_voice = voice or "longxiaochun_v2"
            if not actual_voice.endswith("_v2") and actual_model == "cosyvoice-v2":
                actual_voice = f"{actual_voice}_v2"

            # 尝试 CosyVoice-v2 合成（带重试）
            for attempt in range(3):
                try:
                    from dashscope.audio.tts_v2 import SpeechSynthesizer
                    syn = SpeechSynthesizer(model=actual_model, voice=actual_voice)
                    audio_data = syn.call(text)
                    if audio_data and len(audio_data) > 0:
                        break
                except Exception as ce:
                    last_error = ce
                    time.sleep(0.8)

            # 若 CosyVoice 多次网络重试均不可用，平滑降级到对应高质量 Sambert 音色
            if not audio_data or len(audio_data) == 0:
                fallback_voice = "sambert-zhiwei-v1" if ("chun" in actual_voice or "miao" in actual_voice or "xiao" in actual_voice) else (
                    "sambert-zhiting-v1" if "wan" in actual_voice else "sambert-zhiming-v1"
                )
                try:
                    from dashscope.audio.tts import SpeechSynthesizer
                    r = SpeechSynthesizer.call(model=fallback_voice, text=text, format="mp3")
                    if r.get_response() and r.get_response().status_code == 200:
                        audio_data = r.get_audio_data()
                except Exception as fe:
                    last_error = fe
        else:
            from dashscope.audio.tts import SpeechSynthesizer
            r = SpeechSynthesizer.call(model=model, text=text, format="mp3")
            resp = r.get_response()
            if resp and resp.status_code != 200 and str(resp.status_code) != "HTTPStatus.OK":
                sys.stderr.write(f"Error: DashScope TTS failed with status {resp.status_code}: {resp.message}\n")
                sys.exit(1)
            audio_data = r.get_audio_data()

        if not audio_data or len(audio_data) == 0:
            sys.stderr.write(f"Error: No audio data returned for model {model} (last_error: {last_error})\n")
            sys.exit(1)

        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        with open(args.output, "wb") as f:
            f.write(audio_data)

        print(f"OK: wrote {len(audio_data)} bytes to {args.output}")
        sys.exit(0)

    except Exception as e:
        sys.stderr.write(f"Exception in TTS: {str(e)}\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
