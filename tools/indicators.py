#!/usr/bin/env python3
"""Explicit, append-only dated indicator observations and publication events."""
import argparse
import copy
import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / 'data' / 'indicator-snapshots.json'
NAMES = ('全球散戶', '外資情緒', '位階增溫', '社交反指', '量能爆衝')


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError('timestamp required')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('timestamp must include timezone')
    return parsed.astimezone(timezone.utc)


def validate_snapshot(s):
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', s['date']):
        raise ValueError('invalid date')
    datetime.strptime(s['date'], '%Y-%m-%d')
    if type(s.get('revision')) is not int or s['revision'] < 1:
        raise ValueError('invalid revision')
    captured = timestamp(s['captured_at'])
    if captured.astimezone(ZoneInfo('Asia/Taipei')).date().isoformat() != s['date']:
        raise ValueError('capture date differs from Taipei observation date')
    for field in ('source_sha256', 'source_json_sha256'):
        if not isinstance(s.get(field), str) or not re.fullmatch(r'[0-9a-f]{64}', s[field]):
            raise ValueError('invalid source hash')
    if not s.get('estimation_method_version'):
        raise ValueError('missing method version')
    values = s['indicators']
    if not isinstance(values, list) or len(values) != len(NAMES):
        raise ValueError('five indicators required')
    names = [v.get('name') for v in values]
    if len(set(names)) != 5 or set(names) != set(NAMES):
        raise ValueError('missing, duplicate or unknown indicator')
    for item in values:
        v = item.get('value')
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= 100:
            raise ValueError('invalid indicator value')
        if not isinstance(item.get('approximate'), bool):
            raise ValueError('approximate flag required')
    return s


def load_store(path=STORE):
    data = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'schema_version': 1, 'snapshots': [], 'publication_events': []}
    seen = set()
    previous = {}
    for s in data['snapshots']:
        validate_snapshot(s)
        key = (s['date'], s['revision'])
        if key in seen:
            raise ValueError('duplicate date/revision')
        prior = previous.get(s['date'])
        if s['revision'] != (prior['revision'] + 1 if prior else 1):
            raise ValueError('revision must be sequential in append order')
        if prior and timestamp(s['captured_at']) < timestamp(prior['captured_at']):
            raise ValueError('revision capture before previous capture')
        seen.add(key)
        previous[s['date']] = s
    event_keys = set()
    for e in data['publication_events']:
        published = timestamp(e['available_at'])
        if type(e.get('revision')) is not int or e['revision'] < 1:
            raise ValueError('invalid publication revision')
        if published > datetime.now(timezone.utc):
            raise ValueError('publication cannot be in the future')
        if (e['date'], e['revision']) not in seen:
            raise ValueError('publication refers to missing revision')
        key = (e['date'], e['revision'])
        if key in event_keys:
            raise ValueError('duplicate publication event')
        event_keys.add(key)
        snap = next(s for s in data['snapshots'] if (s['date'], s['revision']) == key)
        if published < timestamp(snap['captured_at']):
            raise ValueError('publication before capture')
    return data


def append_snapshot(store, snapshot):
    validate_snapshot(snapshot)
    prior = [s for s in store['snapshots'] if s['date'] == snapshot['date']]
    same = next((s for s in prior if s['revision'] == snapshot['revision']), None)
    if same:
        if same != snapshot:
            raise ValueError('conflicting overwrite rejected')
        return False
    if snapshot['revision'] != len(prior) + 1:
        raise ValueError('revision must be next sequential integer')
    if prior and timestamp(snapshot['captured_at']) < timestamp(prior[-1]['captured_at']):
        raise ValueError('revision capture before previous capture')
    store['snapshots'].append(copy.deepcopy(snapshot))
    return True


def append_publication(store, date, revision, available_at):
    pub = timestamp(available_at)
    if type(revision) is not int or revision < 1 or pub > datetime.now(timezone.utc):
        raise ValueError('invalid publication timestamp or revision')
    snap = next((s for s in store['snapshots'] if s['date'] == date and s['revision'] == revision), None)
    if snap is None or pub < timestamp(snap['captured_at']):
        raise ValueError('invalid publication timestamp or revision')
    old = next((e for e in store['publication_events'] if e['date'] == date and e['revision'] == revision), None)
    event = {'date': date, 'revision': revision, 'available_at': available_at}
    if old and old != event:
        raise ValueError('conflicting publication overwrite rejected')
    if not old:
        store['publication_events'].append(event)


def latest_by_date(store):
    result = {}
    for s in store['snapshots']:
        if s['date'] not in result or s['revision'] > result[s['date']]['revision']:
            result[s['date']] = s
    return result


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest='action', required=True)
    i = sub.add_parser('import'); i.add_argument('--date', required=True); i.add_argument('--source', type=Path, required=True); i.add_argument('--image', type=Path, required=True); i.add_argument('--revision', type=int, default=1); i.add_argument('--method-version', required=True)
    a = sub.add_parser('publish'); a.add_argument('--date', required=True); a.add_argument('--revision', type=int, required=True); a.add_argument('--available-at', required=True)
    args = p.parse_args(); store = load_store()
    if args.action == 'import':
        src = json.loads(args.source.read_text(encoding='utf-8'))
        if src.get('sourceImage') != args.image.name:
            raise ValueError('image filename differs from source')
        snapshot = {'date': args.date, 'revision': args.revision, 'captured_at': src['capturedAt'], 'source_sha256': hashlib.sha256(args.image.read_bytes()).hexdigest(), 'source_json_sha256': hashlib.sha256(args.source.read_bytes()).hexdigest(), 'estimation_method_version': args.method_version, 'indicators': [{'name': x['name'], 'value': x['value'], 'approximate': x['approximate']} for x in src['indicators']]}
        append_snapshot(store, snapshot)
    else:
        append_publication(store, args.date, args.revision, args.available_at)
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(store, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
