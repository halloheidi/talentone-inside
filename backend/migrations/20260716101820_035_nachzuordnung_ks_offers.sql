-- Nachzuordnung: 2 verwaiste K&S-Angebote dem internen Kunden zuordnen.
-- (FEFA Service GmbH blieb verwaist — zum Zeitpunkt kein passender talentone_kunde.)
update talentone_offers
set customer_id = 'fd6882da-3fea-4930-8a33-924a9247862f'
where id in ('a0692abe-ae52-4acd-bb7f-766ac836f9fe', 'e8e6ea45-3af3-423b-bd18-1a264da70602')
  and customer_id is null;

-- Zugehörige Rechnungen des K&S-Direktauftrags mit-nachziehen (customer_id via offer_id).
update talentone_invoices i
set customer_id = 'fd6882da-3fea-4930-8a33-924a9247862f'
from talentone_offers o
where i.offer_id = o.id
  and o.customer_id = 'fd6882da-3fea-4930-8a33-924a9247862f'
  and i.customer_id is null;
