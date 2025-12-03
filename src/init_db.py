import sqlite3

DB_FILE = "railway.db"

def main():
    conn = sqlite3.connect(DB_FILE)
    with open("schema.sql", "r", encoding="utf-8") as f:
        conn.executescript(f.read())
    conn.commit()
    conn.close()
    print("Database created and schema applied ->", DB_FILE)

if __name__ == "__main__":
    main()
