/**
 * Fetch Lincoln Center Events
 * Scrapes public event listings from Lincoln Center constituent organizations
 * and outputs data/events.json for the static frontend.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

function fetchURL(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CurtainCall/1.0)' }, timeout: 15000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        return fetchURL(loc, maxRedirects - 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
  });
}

async function fetchMetOpera() {
  const events = [];
  try {
    const { body } = await fetchURL('https://www.metopera.org/season/2025-26-season/');
    // Parse production links: href="/season/2025-26-season/SLUG/"
    const linkRegex = /href="\/season\/2025-26-season\/([^"]+)\/"/g;
    const slugs = new Set();
    let m;
    while ((m = linkRegex.exec(body)) !== null) slugs.add(m[1]);

    // Extract title from slug and find date ranges in surrounding text
    // Better: parse the structured text blocks
    // Pattern: "ComposerDate range\n\nTitle\n"
    const blocks = body.split(/href="\/season\/2025-26-season\//);
    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i];
      const slugMatch = block.match(/^([^"]+)"/);
      if (!slugMatch) continue;
      const slug = slugMatch[1].replace(/\/$/, '');

      // Find the title - it appears in an h-tag or prominent text after the link
      // Extract from slug as fallback
      const title = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        .replace(/^The /, 'The ').replace(/^La /, 'La ').replace(/^I /, 'I ');

      // Find date in the text before this block
      const preceding = blocks[i - 1].slice(-200);
      const dateMatch = preceding.match(/([A-Z][a-z]{2}\s+\d{1,2})\s*[-–]\s*([A-Z][a-z]{2}\s+\d{1,2})/);

      events.push({
        source: 'metopera',
        company: 'opera',
        title: beautifyTitle(slug),
        date: dateMatch ? `${dateMatch[1]} – ${dateMatch[2]}` : '',
        time: '',
        venue: 'Metropolitan Opera House',
        url: `https://www.metopera.org/season/2025-26-season/${slug}/`,
        badge: ''
      });
    }
    // Deduplicate by slug
    const seen = new Set();
    return events.filter(e => {
      const key = e.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (e) {
    console.warn('Met Opera fetch failed:', e.message);
    return [];
  }
}

function beautifyTitle(slug) {
  const titleMap = {
    'the-amazing-adventures-of-kavalier--clay': 'The Amazing Adventures of Kavalier & Clay',
    'andrea-chenier': 'Andrea Chénier',
    'arabella': 'Arabella',
    'la-boheme': 'La Bohème',
    'carmen': 'Carmen',
    'don-giovanni': 'Don Giovanni',
    'eugene-onegin': 'Eugene Onegin',
    'la-fille-du-regiment': 'La Fille du Régiment',
    'innocence': 'Innocence',
    'madama-butterfly': 'Madama Butterfly',
    'the-magic-flute-holiday-presentation': 'The Magic Flute',
    'porgy-and-bess': 'Porgy and Bess',
    'i-puritani': 'I Puritani',
    'la-sonnambula': 'La Sonnambula',
    'la-traviata': 'La Traviata',
    'tristan-und-isolde': 'Tristan und Isolde',
    'turandot': 'Turandot',
    'el-ultimo-sueno-de-frida-y-diego': 'El Último Sueño de Frida y Diego',
    'laffont-grand-finals-concert': 'Laffont Grand Finals Concert',
    'the-met-orchestra-at-carnegie-hall': 'The Met Orchestra at Carnegie Hall'
  };
  return titleMap[slug] || slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

async function fetchJALC() {
  const events = [];
  try {
    // Try WordPress REST API
    const { status, body } = await fetchURL('https://jazz.org/wp-json/wp/v2/tiva_event?per_page=20&orderby=date&order=asc');
    if (status === 200) {
      const items = JSON.parse(body);
      if (Array.isArray(items)) {
        for (const evt of items) {
          events.push({
            source: 'jalc',
            company: 'jazz',
            title: (evt.title?.rendered || '').replace(/<[^>]+>/g, ''),
            date: evt.date || '',
            time: '',
            venue: 'Jazz at Lincoln Center',
            url: evt.link || '',
            badge: ''
          });
        }
      }
    }
  } catch (e) {
    console.warn('JALC fetch failed:', e.message);
  }
  return events;
}

async function fetchFilmLinc() {
  const events = [];
  try {
    const { body } = await fetchURL('https://www.filmlinc.org/daily/');
    // Look for film titles in links
    const regex = /href="(https?:\/\/www\.filmlinc\.org\/films\/[^"]+)"[^>]*>([^<]+)/gi;
    let m;
    while ((m = regex.exec(body)) !== null) {
      events.push({
        source: 'filmlinc',
        company: 'film',
        title: m[2].trim(),
        date: '',
        time: '',
        venue: 'Film at Lincoln Center',
        url: m[1],
        badge: ''
      });
    }
  } catch (e) {
    console.warn('Film at LC fetch failed:', e.message);
  }
  // Deduplicate
  const seen = new Set();
  return events.filter(e => {
    if (seen.has(e.url)) return false;
    seen.add(e.url);
    return true;
  });
}

async function main() {
  console.log('Fetching Lincoln Center events...');

  const [opera, jazz, film] = await Promise.all([
    fetchMetOpera(),
    fetchJALC(),
    fetchFilmLinc()
  ]);

  const allEvents = [...opera, ...jazz, ...film];
  console.log(`Fetched: Met Opera ${opera.length}, JALC ${jazz.length}, Film ${film.length} = ${allEvents.length} total`);

  const output = {
    lastUpdated: new Date().toISOString(),
    eventCount: allEvents.length,
    sources: {
      metopera: { count: opera.length, url: 'https://www.metopera.org/season/2025-26-season/' },
      jalc: { count: jazz.length, url: 'https://jazz.org/concerts-events/calendar/' },
      filmlinc: { count: film.length, url: 'https://www.filmlinc.org/daily/' },
      nycballet: { count: 0, url: 'https://www.nycballet.com/', note: 'JS-rendered, needs headless browser' },
      nyphil: { count: 0, url: 'https://nyphil.org/', note: 'JS-rendered, needs headless browser' },
      lct: { count: 0, url: 'https://www.lct.org/', note: 'No public API found' }
    },
    events: allEvents
  };

  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'events.json'), JSON.stringify(output, null, 2));
  console.log('Wrote data/events.json');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
