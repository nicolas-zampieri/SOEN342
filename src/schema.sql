DROP TABLE IF EXISTS TripTraveller;
DROP TABLE IF EXISTS Trip;
DROP TABLE IF EXISTS Traveller;
DROP TABLE IF EXISTS Route;

CREATE TABLE Route (
    route_id        TEXT PRIMARY KEY,
    departure_city  TEXT NOT NULL,
    arrival_city    TEXT NOT NULL,
    departure_time  TEXT NOT NULL, -- "HH:MM"
    arrival_time    TEXT NOT NULL,
    train_type      TEXT,
    days_of_op      TEXT,
    first_class     REAL,
    second_class    REAL
);

CREATE TABLE Traveller (
    traveller_id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name   TEXT NOT NULL,
    last_name    TEXT NOT NULL,
    gov_id       TEXT NOT NULL UNIQUE,
    age          INTEGER
);

CREATE TABLE Trip (
    trip_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    travel_date    TEXT NOT NULL,   -- "YYYY-MM-DD"
    origin         TEXT NOT NULL,
    destination    TEXT NOT NULL,
    stops          INTEGER NOT NULL,
    total_duration INTEGER NOT NULL,
    fare_class     TEXT NOT NULL,   -- "first" / "second"
    path_summary   TEXT NOT NULL,
    created_at     TEXT NOT NULL    -- ISO timestamp
);

CREATE TABLE TripTraveller (
    trip_id       INTEGER NOT NULL,
    traveller_id  INTEGER NOT NULL,
    seat_class    TEXT NOT NULL,
    ticket_price  REAL NOT NULL,
    PRIMARY KEY (trip_id, traveller_id),
    FOREIGN KEY (trip_id) REFERENCES Trip(trip_id),
    FOREIGN KEY (traveller_id) REFERENCES Traveller(traveller_id)
);
