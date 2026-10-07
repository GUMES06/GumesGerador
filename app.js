'use strict';

function validLuhn(value) {
  if (!/^[0-9 -]+$/.test(value)) return false;

  const number = value.replace(/[ -]/g, '');

  if (
    number.length < 2 ||
    number.length > 19 ||
    /^0+$/.test(number)
  ) {
    return false;
  }

  let sum = 0,
    double = false;

  for (let i = number.length - 1; i >= 0; i--) {
    let d = Number(number[i]);

    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }

    sum += d;
    double = !double;
  }

  return sum % 10 === 0;
}

function luhnDigit(base) {
  let sum = 0,
    double = true;

  for (let i = base.length - 1; i >= 0; i--) {
    let d = Number(base[i]);

    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }

    sum += d;
    double = !double;
  }

  return String((10 - (sum % 10)) % 10);
}

function randomInt(min, max) {
  const range = max - min + 1,
    limit = Math.floor(4294967296 / range) * range;

  let x;

  do {
    x = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (x >= limit);

  return min + (x % range);
}

function generateRecords(quantity, mode, opts, now = new Date()) {
  const y = now.getFullYear(),
    m = now.getMonth() + 1;

  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 1000
  )
    throw Error('Informe uma quantidade de 1 a 1000.');

  let start = y * 12 + m - 1,
    end = (y + 6) * 12 + m - 1;

  if (mode === 'manual') {
    if (
      !Number.isInteger(opts.year) ||
      !Number.isInteger(opts.month) ||
      opts.month < 1 ||
      opts.month > 12 ||
      opts.year < y ||
      opts.year > y + 20
    )
      throw Error(
        `Use um mês de 1 a 12 e um ano de ${y} a ${y + 20}.`
      );

    start = end = opts.year * 12 + opts.month - 1;

    if (start < y * 12 + m - 1)
      throw Error('Escolha o mês atual ou uma data futura.');
  } else if (mode === 'range') {
    if (
      !Number.isInteger(opts.start) ||
      !Number.isInteger(opts.end) ||
      opts.start < y ||
      opts.end > y + 20 ||
      opts.end < opts.start
    )
      throw Error(
        `Informe anos entre ${y} e ${y + 20}, com o final igual ou maior que o inicial.`
      );

    start = Math.max(opts.start * 12, y * 12 + m - 1);
    end = opts.end * 12 + 11;
  } else if (mode !== 'random')
    throw Error('Modo de data inválido.');

  const bin = String(opts.bin || '').trim(),
    cvv = String(opts.cvv || '').trim();

  if (!/^[1-9][0-9]{0,15}$/.test(bin))
    throw Error(
      'Informe de 1 a 16 dígitos, sem espaços e sem zero inicial.'
    );

  if (cvv && !/^[0-9]{3}$/.test(cvv))
    throw Error(
      'Informe um CVV de 3 dígitos ou deixe vazio para sortear.'
    );

  if (bin.length === 16 && !validLuhn(bin))
    throw Error(
      'O número completo informado não passa no checksum de Luhn. Confira os 16 dígitos.'
    );

  const seen = new Set(),
    records = [],
    capacity = 10 ** Math.max(0, 15 - bin.length);

  while (records.length < quantity) {
    let base = bin;

    while (base.length < 15) base += randomInt(0, 9);

    const number =
      bin.length === 16 ? bin : base + luhnDigit(base);

    if (seen.size === capacity) seen.clear();

    if (seen.has(number)) continue;

    seen.add(number);

    const date = randomInt(start, end);

    records.push({
      number,
      month: (date % 12) + 1,
      year: Math.floor(date / 12),
      cvv:
        cvv ||
        String(randomInt(0, 999)).padStart(3, '0')
    });
  }

  return records;
}

function formatRecord(r) {
  return `${r.number}|${String(r.month).padStart(2, '0')}|${r.year}|${r.cvv}`;
}

function assessLine(line, now = new Date()) {
  const parts = line
      .trim()
      .split('|')
      .map(x => x.trim()),
    number = parts[0] || '',
    bin = /^\d{6}/.test(number)
      ? number.slice(0, 6)
      : '';

  const base = {
    line: line.trim(),
    bin,
    number
  };

  if (
    parts.length !== 4 ||
    !/^\d{13,19}$/.test(number) ||
    !/^\d{1,2}$/.test(parts[1]) ||
    !/^\d{4}$/.test(parts[2]) ||
    !/^\d{3,4}$/.test(parts[3])
  )
    return {
      ...base,
      status: 'error',
      reason:
        'Formato inválido. Use cc|mes|ano|cvv (ano com 4 dígitos).'
    };

  const month = Number(parts[1]),
    year = Number(parts[2]);

  if (
    month < 1 ||
    month > 12 ||
    year < 2000 ||
    year > 2099
  )
    return {
      ...base,
      status: 'error',
      reason: 'Mês ou ano fora do intervalo permitido.'
    };

  if (!validLuhn(number))
    return {
      ...base,
      status: 'declined',
      reason: 'Checksum de Luhn inválido.'
    };

  if (
    year * 12 + month <
    now.getFullYear() * 12 + now.getMonth() + 1
  )
    return {
      ...base,
      status: 'declined',
      reason: 'Validade vencida.'
    };

  return {
    ...base,
    status: 'approved',
    reason:
      'Formato, checksum e validade passaram na simulação local.'
  };
}

const binCache = new Map();
let binRequests = 0;

async function lookupBin(bin) {
  if (!bin)
    return {
      scheme: 'Não identificado',
      bank: 'Não informado',
      type: 'Não informado',
      level: 'Não informado',
      error: 'BIN indisponível: formato inválido.'
    };

  if (binCache.has(bin)) return binCache.get(bin);

  const task = (async () => {
    const empty = {
      scheme: 'Não identificado',
      bank: 'Não informado',
      type: 'Não informado',
      level: 'Não informado'
    };

    if (binRequests >= 5)
      return {
        ...empty,
        error:
          'Limite local de 5 consultas de BIN por sessão atingido.'
      };

    binRequests++;

    try {
      const response = await fetch(
        'https://lookup.binlist.net/' + bin,
        {
          headers: {
            'Accept-Version': '3'
          },
          signal: AbortSignal.timeout(5000),
          credentials: 'omit'
        }
      );

      if (!response.ok)
        throw Error(
          response.status === 429
            ? 'Limite de consultas do serviço atingido.'
            : response.status === 404
              ? 'BIN não encontrado.'
              : 'Serviço de BIN indisponível (' +
                response.status +
                ').'
        );

      const data = await response.json();

      const names = {
        visa: 'Visa',
        mastercard: 'Mastercard',
        amex: 'American Express',
        discover: 'Discover',
        jcb: 'JCB',
        diners: 'Diners Club',
        unionpay: 'UnionPay',
        elo: 'Elo',
        hipercard: 'Hipercard'
      };

      return {
        scheme:
          names[data.scheme] ||
          data.scheme ||
          empty.scheme,
        bank: data.bank?.name || empty.bank,
        type:
          {
            credit: 'Crédito',
            debit: 'Débito'
          }[data.type] ||
          data.type ||
          empty.type,
        level: empty.level,
        error: '',
        product: data.brand || 'Não informado'
      };
    } catch (err) {
      return {
        ...empty,
        error:
          err.name === 'TimeoutError'
            ? 'Consulta de BIN excedeu 5 segundos.'
            : err.message === 'Failed to fetch'
              ? 'Consulta de BIN indisponível: rede ou acesso bloqueado.'
              : err.message
      };
    }
  })();

  binCache.set(bin, task);

  return task;
}

if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id),
    now = new Date(),
    year = now.getFullYear();

  for (let m = 1; m <= 12; m++)
    $('month').add(
      new Option(
        String(m).padStart(2, '0'),
        String(m)
      )
    );

  $('month').value = String(now.getMonth() + 1);
  $('year').value = year + 3;
  $('year-start').value = year;
  $('year-end').value = year + 6;

  ['year', 'year-start', 'year-end'].forEach(id => {
    $(id).min = year;
    $(id).max = year + 20;
  });

  document
    .querySelectorAll('[name="mode"]')
    .forEach(r =>
      r.addEventListener('change', () => {
        ['random', 'manual', 'range'].forEach(
          mode =>
            ($(mode + '-fields').hidden =
              mode !== r.value)
        );

        $('generate-error').textContent = '';
      })
    );

  $('generate-form').addEventListener('submit', e => {
    e.preventDefault();

    try {
      const records = generateRecords(
        Number($('quantity').value),
        document.querySelector(
          '[name="mode"]:checked'
        ).value,
        {
          bin: $('bin').value,
          cvv: $('cvv').value,
          month: Number($('month').value),
          year: Number($('year').value),
          start: Number($('year-start').value),
          end: Number($('year-end').value)
        }
      );

      $('results').value = records
        .map(formatRecord)
        .join('\n');

      $('results').hidden = false;
      $('empty').hidden = true;

      $('count').textContent =
        `${records.length} ${
          records.length === 1
            ? 'registro'
            : 'registros'
        }`;

      $('output-status').textContent =
        `Lote gerado às ${new Date().toLocaleTimeString(
          'pt-BR',
          {
            hour: '2-digit',
            minute: '2-digit'
          }
        )}`;

      $('generate-error').textContent = '';
    } catch (err) {
      $('generate-error').textContent = err.message;
    }
  });

  $('check-form').addEventListener(
    'submit',
    async e => {
      e.preventDefault();

      const lines = $('check-input')
        .value.split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean);

      if (!lines.length || lines.length > 1000) {
        $('check-error').textContent =
          'Cole de 1 a 1000 linhas para validar.';
        return;
      }

      $('check-error').textContent = '';
      $('check-button').disabled = true;
      $('check-button').textContent = 'Validando…';

      const counts = {
        approved: 0,
        declined: 0,
        error: 0
      };

      ['approved', 'declined', 'error'].forEach(
        key => {
          $('list-' + key).replaceChildren();
          $('total-' + key).textContent = '0';
        }
      );

      try {
        for (const line of lines) {
          const began = performance.now(),
            r = assessLine(line),
            card =
              document.createElement('article');

          card.className = 'checked-card';

          const heading =
            document.createElement('p');

          heading.className = 'checked-line';

          const elapsed =
            (performance.now() - began).toFixed(1) +
            ' ms';

          heading.textContent =
            r.status === 'approved'
              ? `Live ${r.line} Authorized ${elapsed}`
              : r.status === 'declined'
                ? `Die ${r.line} failed ${elapsed}`
                : `Error ${r.line} erro na matriz`;

          card.append(heading);

          $('list-' + r.status).append(card);

          $('total-' + r.status).textContent =
            String(++counts[r.status]);

          $('check-status').textContent =
            `${counts.approved + counts.declined + counts.error} de ${lines.length} linhas processadas`;
        }
      } catch (err) {
        $('check-error').textContent =
          'Não foi possível concluir: ' +
          err.message;
      } finally {
        $('check-button').disabled = false;
        $('check-button').textContent = 'Validar';
      }
    }
  );

  let installEvent;

  window.addEventListener(
    'beforeinstallprompt',
    e => {
      e.preventDefault();
      installEvent = e;
      $('install-button').hidden = false;
    }
  );

  $('install-button').addEventListener(
    'click',
    async () => {
      if (installEvent) {
        await installEvent.prompt();
        installEvent = null;
        $('install-button').hidden = true;
      }
    }
  );

  if ('serviceWorker' in navigator)
    window.addEventListener('load', () =>
      navigator.serviceWorker
        .register('./sw.js')
        .catch(() => {})
    );
}

if (typeof module !== 'undefined')
  module.exports = {
    validLuhn,
    luhnDigit,
    generateRecords,
    formatRecord,
    assessLine
  };