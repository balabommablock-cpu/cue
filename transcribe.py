"""Bounded in-memory PCM decoder; worker mode keeps MLX and its model warm."""
import base64, json, os, sys, re
from collections import Counter
os.environ['HF_HUB_OFFLINE'] = '1'
import numpy as np


def infer(samples):
    import mlx_whisper
    return mlx_whisper.transcribe(samples,
        path_or_hf_repo=os.environ.get('CUE_WHISPER_MODEL','mlx-community/whisper-small.en-mlx'),
        language='en', condition_on_previous_text=False, temperature=0,
        verbose=None, word_timestamps=False)


def decode(pcm):
    data = base64.b64decode(pcm, validate=True)
    if len(data) < 8000 or len(data) > 1920000 or len(data) % 2:
        raise ValueError('Invalid audio length')
    samples = np.frombuffer(data, dtype='<i2').astype(np.float32) / 32768.0
    if float(np.sqrt(np.mean(samples * samples))) < 0.001 and float(np.max(np.abs(samples))) < 0.005:
        return ''
    text = infer(samples)['text'].strip()
    tokens = re.findall(r"[a-z0-9']+", text.lower())
    if len(tokens) >= 16:
        triples = Counter(tuple(tokens[i:i+3]) for i in range(len(tokens)-2))
        if triples and max(triples.values()) >= 5 and max(triples.values())/(len(tokens)-2) > .23:
            text = ''
    return text[:4000]


def send(value):
    print(json.dumps(value), flush=True)


if '--worker' in sys.argv:
    try:
        # Materialise weights and decoder kernels before accepting real audio.
        # This synthetic silence never leaves the process or becomes a transcript.
        infer(np.zeros(16000, dtype=np.float32))
        send({'type': 'ready'})
    except Exception:
        send({'type': 'error'})
        sys.exit(1)
    while True:
        line = sys.stdin.readline(2_600_001)
        if not line:
            break
        if len(line) > 2_600_000 or not line.endswith('\n'):
            sys.exit(1)
        request = {}
        try:
            request = json.loads(line)
            if not isinstance(request, dict) or not isinstance(request.get('id'), int):
                raise ValueError('Invalid request')
            send({'id': request['id'], 'text': decode(request['pcm'])})
        except Exception:
            send({'id': request.get('id') if isinstance(request, dict) else None, 'error': 'Transcription failed'})
else:
    try:
        send({'text': decode(sys.stdin.read(2_600_001))})
    except Exception:
        send({'error': 'Transcription failed'})
        sys.exit(1)
