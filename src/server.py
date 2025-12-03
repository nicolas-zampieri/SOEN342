import sqlite3
from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime, date

DB_FILE = "railway.db"

app = Flask(__name__)
CORS(app)  # allow calls from your JS

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

# Example: fetch routes (you can extend/optimize)
@app.get("/api/routes")
def get_routes():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM Route")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)

# Book a trip
@app.post("/api/trips")
def book_trip():
    data = request.json

    # expected keys from frontend
    travel_date = data["travel_date"]       # "YYYY-MM-DD"
    origin = data["origin"]
    destination = data["destination"]
    stops = data["stops"]
    total_duration = data["total_duration"]
    fare_class = data["fare_class"]         # "first"/"second"
    path_summary = data["path_summary"]
    price_per_passenger = data["price_per_passenger"]
    travellers = data["travellers"]         # list of {name, age, gov_id}

    conn = get_db()
    cur = conn.cursor()

    # insert trip
    created_at = datetime.utcnow().isoformat()
    cur.execute(
        """
        INSERT INTO Trip
        (travel_date, origin, destination, stops, total_duration, fare_class, path_summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            travel_date,
            origin,
            destination,
            stops,
            total_duration,
            fare_class,
            path_summary,
            created_at,
        ),
    )
    trip_id = cur.lastrowid

    # ensure travellers exist + link
    for t in travellers:
        full = t["name"].strip()
        gov = t["gov_id"].strip()
        age = t.get("age")

        parts = full.split()
        if len(parts) == 1:
            first, last = parts[0], parts[0]
        else:
            last = parts[-1]
            first = " ".join(parts[:-1])

        # find or create traveller by gov_id
        cur.execute("SELECT * FROM Traveller WHERE gov_id = ?", (gov,))
        row = cur.fetchone()
        if row:
            traveller_id = row["traveller_id"]
        else:
            cur.execute(
                """
                INSERT INTO Traveller (first_name, last_name, gov_id, age)
                VALUES (?, ?, ?, ?)
                """,
                (first, last, gov, age),
            )
            traveller_id = cur.lastrowid

        # link
        cur.execute(
            """
            INSERT INTO TripTraveller (trip_id, traveller_id, seat_class, ticket_price)
            VALUES (?, ?, ?, ?)
            """,
            (trip_id, traveller_id, fare_class, price_per_passenger),
        )

    conn.commit()
    conn.close()

    # return numeric trip id
    return jsonify({"trip_id": trip_id}), 201

# View trips for a passenger
@app.get("/api/trips")
def get_trips_for_passenger():
    last_name = request.args.get("last_name", "").strip().lower()
    gov_id = request.args.get("gov_id", "").strip().lower()
    if not last_name or not gov_id:
        return jsonify({"error": "Missing last_name or gov_id"}), 400

    conn = get_db()
    cur = conn.cursor()

    # find traveller
    cur.execute(
        """
        SELECT * FROM Traveller
        WHERE lower(last_name) = ? AND lower(gov_id) = ?
        """,
        (last_name, gov_id),
    )
    traveller = cur.fetchone()
    if not traveller:
        conn.close()
        return jsonify({"upcoming": [], "history": []})

    traveller_id = traveller["traveller_id"]

    # find linked trips
    cur.execute(
        """
        SELECT t.trip_id, t.travel_date, t.origin, t.destination,
               t.stops, t.total_duration, t.fare_class, t.path_summary,
               tt.ticket_price
        FROM Trip t
        JOIN TripTraveller tt ON t.trip_id = tt.trip_id
        WHERE tt.traveller_id = ?
        ORDER BY t.travel_date ASC
        """,
        (traveller_id,),
    )

    today = date.today().isoformat()
    upcoming, history = [], []
    for row in cur.fetchall():
        rec = {
            "trip_id": row["trip_id"],
            "date": row["travel_date"],
            "itinerary": row["path_summary"],
            "fare_class": row["fare_class"],
            "ticket_price": row["ticket_price"],
        }
        if row["travel_date"] >= today:
            upcoming.append(rec)
        else:
            history.append(rec)

    conn.close()
    return jsonify({"upcoming": upcoming, "history": history})

if __name__ == "__main__":
    app.run(debug=True)
