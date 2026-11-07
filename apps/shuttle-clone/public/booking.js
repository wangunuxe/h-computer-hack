/* global jQuery */
function addressSuggestions(query, pickup) {
  const addresses = [
    ['Gare du Nord, 18 Rue de Dunkerque, Paris', 48.8809, 2.3553],
    ['Gare de Lyon, Place Louis-Armand, Paris', 48.8449, 2.3735],
    ['Gare Montparnasse, 17 Boulevard de Vaugirard, Paris', 48.8412, 2.3205],
    ['Gare de l’Est, Place du 11 Novembre 1918, Paris', 48.8769, 2.3591],
    ['Charles de Gaulle–Étoile, Place Charles de Gaulle, Paris', 48.8738, 2.2950],
    ['Châtelet–Les Halles, Paris', 48.8619, 2.3470],
    ['CDG Airport Terminal 1, Roissy-en-France', 49.0097, 2.5479],
    ['CDG Airport Terminal 2E, Roissy-en-France', 49.0038, 2.5795],
    ['CDG Airport Terminal 2F, Roissy-en-France', 49.0033, 2.6006],
    ['CDG Airport Terminal 3, Roissy-en-France', 49.0131, 2.5587],
    ['Orly Airport Terminal 4, Orly', 48.7284, 2.3659],
    ['Hôtel de Ville, Place de l’Hôtel de Ville, Paris', 48.8566, 2.3522],
    ['Tour Eiffel, 5 Avenue Anatole France, Paris', 48.8584, 2.2945],
    ['Louvre Museum, Rue de Rivoli, Paris', 48.8606, 2.3376],
  ];
  const normalize = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const text = query.trim();
  if (!text) return [];
  const matches = addresses.filter(([address]) => normalize(address).includes(normalize(text)));
  // Custom pickup coordinates are a Paris-centre simulation, not geocoding.
  return matches.length ? matches : pickup && text.length >= 3 ? [[text, 48.8566, 2.3522]] : [];
}
jQuery(function ($) {
  $('#pickup-date').each(function () {
    const input = $(this);
    input.datepicker({
      dateFormat: 'yy-mm-dd',
      minDate: $.datepicker.parseDate('yy-mm-dd', input.attr('data-min-date')),
    });
  });
  $('.address-input').on('input', function () {
    const input = $(this);
    const name = input.attr('name');
    const field = input.closest('.address');
    field.find('input[type=hidden]').val('');
    const list = field.find('.suggestions').empty();
    const query = String(input.val()).trim();
    if (!query) return;
    addressSuggestions(query, name === 'pickup').forEach(([address, lat, lng]) => {
      $('<div class="suggestion"></div>').text(address).on('click', function () {
        input.val(address);
        field.find('input[name="' + name + '_lat"]').val(lat);
        field.find('input[name="' + name + '_lng"]').val(lng);
        list.empty();
      }).appendTo(list);
    });
  });
  const form = document.getElementById('checkout-form');
  if (form && document.getElementById('countdown')) {
    let seconds = 2;
    const timer = setInterval(function () {
      seconds -= 1;
      document.getElementById('countdown').textContent = String(seconds);
      if (seconds === 0) {
        clearInterval(timer);
        form.requestSubmit();
      }
    }, 1000);
    form.addEventListener('submit', function () { clearInterval(timer); });
  }
});
