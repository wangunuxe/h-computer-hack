# Paris Airport Shuttle — mock site manual

Simulation only. Start at `/fr/reservation/` (default real mode).
For easy mode start a new draft at `/fr/reservation/?difficulty=easy`.
The redirect includes a draft id; keep this URL through the flow. Mode is sticky
for that draft. No CAPTCHA or anti-bot challenge is simulated.

## Field order

1. **Step 1 — Route**: Pickup address; Dropoff address; Pickup date; Pickup time;
   **Continue to vehicles**. URL: `/fr/reservation/<draft-id>/route`.
2. **Step 2 — Vehicle**: Vehicle class; **Continue to passenger information**.
   URL: `/fr/reservation/<draft-id>/vehicle`.
3. **Step 3 — Passenger information**: Full name; Email; Telephone; Passengers;
   Luggage; collapsed **Additional information / Notes**; inside it the
   **Notes for the driver** textarea; **Create booking and continue to payment**.
   URL: `/fr/reservation/<draft-id>/info`. Obtain user confirmation of route,
   date, time, price and dog note BEFORE clicking the final button.
4. **Step 4 — Payment**: summary (reference, pickup, dropoff, pickup date/time,
   vehicle, price, passenger contacts, passenger/luggage counts, operator phone,
   status, notes), countdown, **Pay via Credit Card**, **View booking confirmation**.
   No further booking inputs.

## Control quirks

- All labels intentionally lack associations; locate inputs visually by order.
- Addresses: type a substring and CLICK a matching dropdown div below the input.
  Clicking fills hidden lat/lng fields. Typing without selecting fails on submit:
  “Select both addresses from the suggestion dropdown (missing lat/lng).”
  Editing the address clears hidden coordinates, so select again.
- Available suggestions (case-insensitive substring matching):
  - Gare du Nord, 18 Rue de Dunkerque, Paris
  - Gare de Lyon, Place Louis-Armand, Paris
  - Gare Montparnasse, 17 Boulevard de Vaugirard, Paris
  - Gare de l’Est, Place du 11 Novembre 1918, Paris
  - CDG Airport Terminal 1, Roissy-en-France
  - CDG Airport Terminal 2E, Roissy-en-France
  - CDG Airport Terminal 2F, Roissy-en-France
  - CDG Airport Terminal 3, Roissy-en-France
  - Orly Airport Terminal 4, Orly
  - Hôtel de Ville, Place de l’Hôtel de Ville, Paris
  - Tour Eiffel, 5 Avenue Anatole France, Paris
  - Louvre Museum, Rue de Rivoli, Paris
- Real-mode date: readonly text. CLICK it to open jQuery UI calendar, use the
  header's left/right arrows to change month, then click a day. Earlier days
  before Europe/Paris today are disabled, regardless of browser timezone. The
  selected format is YYYY-MM-DD; do not type into it.
- Easy-mode date: native date input. Addresses accept nonempty free text without
  coordinates in easy mode. All other controls and steps remain unchanged.
- Both modes reject dates before today in Europe/Paris, returning to step 1 with
  “Pickup date cannot be before today (Europe/Paris).” Easy mode also sets the
  native date input minimum to Paris today. Choose today or a later date.
- Today's pickup time must not have already passed in Europe/Paris. Otherwise
  step 1 re-renders with “Pickup date and time cannot be in the past (Europe/Paris).”
  Select a later time (the default 00:00 is usually already past) or a future date.
- Time, vehicle, passengers and luggage are native selects. Use full option text
  below. Time defaults to 00:00; set it explicitly. Times are Paris local time.
- Passenger count must fit the selected vehicle: Sedan 3, Estate 4, Minivan 8.
  Otherwise step 3 stays open with “Selected vehicle allows at most N passengers.”
  Reduce the count or return to the vehicle step and choose a larger vehicle.
- Luggage must also fit: Sedan 2 suitcases, Estate 4, Minivan 8. An excess
  re-renders step 3 with “Selected vehicle allows at most N suitcases.” Reduce
  luggage or return to the vehicle step to choose a larger vehicle.
- Notes are collapsed on page load; click the summary to reveal the textarea.
- Refreshing step 4 or resubmitting info returns the existing order, not a new one.

## Full select option text

### Pickup time (all 96, in order)
- 00:00
- 00:15
- 00:30
- 00:45
- 01:00
- 01:15
- 01:30
- 01:45
- 02:00
- 02:15
- 02:30
- 02:45
- 03:00
- 03:15
- 03:30
- 03:45
- 04:00
- 04:15
- 04:30
- 04:45
- 05:00
- 05:15
- 05:30
- 05:45
- 06:00
- 06:15
- 06:30
- 06:45
- 07:00
- 07:15
- 07:30
- 07:45
- 08:00
- 08:15
- 08:30
- 08:45
- 09:00
- 09:15
- 09:30
- 09:45
- 10:00
- 10:15
- 10:30
- 10:45
- 11:00
- 11:15
- 11:30
- 11:45
- 12:00
- 12:15
- 12:30
- 12:45
- 13:00
- 13:15
- 13:30
- 13:45
- 14:00
- 14:15
- 14:30
- 14:45
- 15:00
- 15:15
- 15:30
- 15:45
- 16:00
- 16:15
- 16:30
- 16:45
- 17:00
- 17:15
- 17:30
- 17:45
- 18:00
- 18:15
- 18:30
- 18:45
- 19:00
- 19:15
- 19:30
- 19:45
- 20:00
- 20:15
- 20:30
- 20:45
- 21:00
- 21:15
- 21:30
- 21:45
- 22:00
- 22:15
- 22:30
- 22:45
- 23:00
- 23:15
- 23:30
- 23:45

### Vehicle class
- Private Sedan — up to 3 passengers, 2 suitcases — 65 EUR
- Comfort Estate — up to 4 passengers, 4 suitcases — 85 EUR
- Private Minivan — up to 8 passengers, 8 suitcases — 110 EUR

### Passengers
- 1 passenger — including children and infants
- 2 passengers — including children and infants
- 3 passengers — including children and infants
- 4 passengers — including children and infants
- 5 passengers — including children and infants
- 6 passengers — including children and infants
- 7 passengers — including children and infants
- 8 passengers — including children and infants

### Luggage
- 0 suitcases — standard checked luggage (max 23 kg each)
- 1 suitcase — standard checked luggage (max 23 kg each)
- 2 suitcases — standard checked luggage (max 23 kg each)
- 3 suitcases — standard checked luggage (max 23 kg each)
- 4 suitcases — standard checked luggage (max 23 kg each)
- 5 suitcases — standard checked luggage (max 23 kg each)
- 6 suitcases — standard checked luggage (max 23 kg each)
- 7 suitcases — standard checked luggage (max 23 kg each)
- 8 suitcases — standard checked luggage (max 23 kg each)

These are the only selects; no separate transfer-type select exists.

## Guide-dog note field

On step 3 CLICK **Additional information / Notes**, then enter the guide-dog
request in **Notes for the driver** (textarea). Suggested French:
“Je voyage avec un chien guide. Merci de confirmer son acceptation.”
There is no dedicated dog/accessibility field. The note does NOT establish
merchant acceptance; report unknown until explicitly confirmed.

## Payment-page signature

Heading **Step 4 — Payment**, reference **PAS-...**, status **UNPAID**,
“Your order has already been created”, countdown starting at **2** seconds,
and **Pay via Credit Card**. URL: `/fr/reservation/payment/<order-id>`.
An unpaid order already exists. Copy the reference/order id for handoff.

After two seconds the form automatically POSTs `/checkout/<order-id>`; the
button submits immediately. This redirects to `https://checkout.stripe.com/...`
when configured, or `/stub-payment/<order-id>?mode=no-stripe-key` without a key.
The stub says **FAKE PAYMENT — LOCAL STUB** and cannot take payment.

Cancelling Stripe returns to the payment URL with `?cancelled=1`. It shows
**Payment cancelled. Your order remains unpaid.** There is NO countdown or
automatic redirect on this return; **Pay via Credit Card** remains a manual retry.

An already-paid order shows **Payment already received. No further payment is
required.** instead of the form/countdown. A completed Stripe session returns to
confirmation, never a second payment. Only expired sessions can be replaced.

Stop agent interaction at handoff; never enter card details or pay.
Confirmation: `/fr/reservation/confirmation/<order-id>` shows reference, pickup,
time, price, operator phone (+33 1 84 80 00 00), paid/unpaid status, notes.
Returning from Stripe alone never marks paid; only a verified webhook does.
