# OCL Expressions for Reservation System

## 1. OCL for Reservation Creation Method (bookTrip)

```ocl
context BookingSystem::bookTrip(data: TripData) : TripID

pre: data.travel_date <> null and data.travel_date.matches('^\d{4}-\d{2}-\d{2}$') and
     data.origin <> data.destination and
     data.travellers->notEmpty() and
     data.travellers->forAll(t | t.name <> null and t.gov_id <> null) and
     (data.fare_class = 'first' or data.fare_class = 'second') and
     data.price_per_passenger > 0

post: Trip.allInstances()->exists(t | t.trip_id = result) and
      TripTraveller.allInstances()->select(tt | tt.trip_id = result)->size() = 
          data.travellers->size() and
      result > 0
```

## 2. OCL for Reservation Class (Trip)

```ocl
context Trip

inv: self.trip_id > 0

inv: self.origin <> self.destination

inv: self.fare_class = 'first' or self.fare_class = 'second'

inv: self.total_duration > 0 and self.total_duration <= 1440

inv: self.stops >= 0 and self.stops <= 3

inv: TripTraveller.allInstances()->exists(tt | tt.trip_id = self.trip_id)

inv: TripTraveller.allInstances()->select(tt | tt.trip_id = self.trip_id)
     ->forAll(tt | tt.seat_class = self.fare_class and tt.ticket_price > 0)
```
