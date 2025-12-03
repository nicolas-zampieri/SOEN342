import csv
import sqlite3

DB_FILE = "railway.db"
CSV_FILE = "eu_rail_network.csv" 

def main():
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()

    with open(CSV_FILE, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rid = row.get("Route ID") or row.get("route_id") or row.get("id")
            dep_city = row.get("Departure City") or row.get("From")
            arr_city = row.get("Arrival City") or row.get("To")
            dep_time = row.get("Departure Time") or row.get("Dep")
            arr_time = row.get("Arrival Time") or row.get("Arr")
            ttype = row.get("Train Type") or row.get("Type") or ""
            days = row.get("Days of Operation") or row.get("Days") or ""
            f1 = row.get("First Class ticket rate (in euro)") or row.get("First Class") or ""
            f2 = row.get("Second Class ticket rate (in euro)") or row.get("Second Class") or ""

            if not (rid and dep_city and arr_city and dep_time and arr_time):
                continue

            cur.execute(
                """
                INSERT OR REPLACE INTO Route
                (route_id, departure_city, arrival_city, departure_time, arrival_time,
                 train_type, days_of_op, first_class, second_class)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(rid).strip(),
                    dep_city.strip(),
                    arr_city.strip(),
                    dep_time.strip(),
                    arr_time.strip(),
                    ttype.strip(),
                    days.strip(),
                    float(f1) if f1 else None,
                    float(f2) if f2 else None,
                ),
            )

    conn.commit()
    conn.close()
    print("Routes loaded into DB from", CSV_FILE)

if __name__ == "__main__":
    main()
