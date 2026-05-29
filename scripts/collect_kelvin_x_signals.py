# scripts/collect_kelvin_x_signals.py
import json
import argparse
import datetime
from pathlib import Path

# Placeholder for the actual xurl tool which isn't available in execute_code
def fetch_from_xurl(query, hours):
    # This is a mock implementation. In a real scenario, this would
    # make an API call to the xurl service.
    # The real implementation is in the hermes agent tool, not here.
    # This script is designed to be run from a context that has xurl.
    print(f"Mock fetching X URLs for query: '{query}' in the last {hours} hours.")
    return [
        {
            "id": f"mock_id_{hash(query)}",
            "text": f"This is a mock tweet for {query}.",
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "author_username": "mock_user",
            "author_name": "Mock User",
            "url": f"https://x.com/mock_user/status/mock_id_{hash(query)}",
        }
    ]

def main():
    parser = argparse.ArgumentParser(description="Collect X signals for Kelvin's morning brief.")
    parser.add_argument("--date", required=True, help="Report date in YYYY-MM-DD format.")
    parser.add_argument("--watchlist", required=True, type=Path, help="Path to the watchlist JSON file.")
    parser.add_argument("--out", required=True, type=Path, help="Output path for the collected signals JSON.")
    parser.add_argument("--hours", type=int, default=24, help="Hours to look back for signals.")
    args = parser.parse_args()

    if not args.watchlist.exists():
        print(f"Error: Watchlist file not found at {args.watchlist}")
        return

    watchlist = json.loads(args.watchlist.read_text(encoding='utf-8'))
    
    all_signals = []
    errors = []

    for item in watchlist:
        query = item.get("query")
        bucket = item.get("bucket")
        tier = item.get("tier")
        why = item.get("why")

        if not query:
            continue

        try:
            # In a real environment, this would be a tool call.
            # Here we simulate it.
            posts = fetch_from_xurl(query, args.hours)
            for post in posts:
                post['watch_bucket'] = bucket
                post['tier'] = tier
                post['why'] = why
                all_signals.append(post)
        except Exception as e:
            error_message = f"Failed to fetch signals for query '{query}': {e}"
            print(error_message)
            errors.append({"query": query, "error": str(e)})

    output_data = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "hours": args.hours,
        "source": "xurl mock API", # Changed from "xurl official X API" to reflect mock
        "ok": not errors,
        "signals": all_signals,
        "errors": errors,
    }

    args.out.write_text(json.dumps(output_data, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f"Successfully collected {len(all_signals)} signals and wrote to {args.out}")

if __name__ == "__main__":
    main()
