// Great Trove — Barbershop Contest Scoresheet Browser

const $ = GreatApp.$;

// ── State ───────────────────────────────────────────────
let bundle = null;          // raw bundle data
let contestsById = {};      // id → contest
let groupsById = {};        // id → group object
let judgeIndex = {};        // normalized name → [{contest, role, district}]
let arrangerIndex = {};     // normalized name → {displayName, entries: [{songName, groupId, contestId}]}
let memberIndex = {};       // normalized name → [{groupId, contestId, part, name}]
let eventsIndex = {};       // eventKey → event object
let eventsArray = [];       // sorted array of events
let navStack = [];          // history for back navigation

// ── Data Loading ────────────────────────────────────────
async function loadBundle() {
  const listEl = $("#contest-list");
  listEl.innerHTML = '<div class="loading-state">Loading contest data...</div>';

  try {
    const resp = await fetch("trove-bundle.json");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    bundle = await resp.json();
  } catch (err) {
    listEl.innerHTML = '<div class="empty-state">Failed to load data. Please refresh.</div>';
    console.error("Bundle load failed:", err);
    return;
  }

  buildIndexes();
  populateYearFilter();
  refreshList();

  // Handle deep link after data is ready
  if (window.location.hash) {
    navigateToHash(window.location.hash, false);
  }
}

function getIntlSubEvent(sourceUrl) {
  if (!sourceUrl) return "main";
  const fname = sourceUrl.split("/").pop().toLowerCase();
  if (fname.includes("nextgen")) return "NextGen Varsity";
  if (fname.includes("varsity")) return "Varsity";
  if (fname.includes("comedy")) return "Comedy";
  if (fname.includes("chorusfestival")) return "Chorus Festival";
  if (fname.includes("collegiate") || /int\d{2}o?cqt/i.test(fname)) return "Collegiate";
  if (/int\d{2}y[a-z]/i.test(fname)) return "Youth";
  if (fname.includes("video_psr")) return "Video";
  if (fname.includes("consolidated")) return "Consolidated";
  return "main";
}

function getEventKey(contest) {
  const { year, season, category, district } = contest;

  // International season: split by sub-event (Varsity, Comedy, etc.)
  if (season === "International") {
    const sub = getIntlSubEvent(contest.sourceUrl);
    return `${year}|International|${category}|${sub}`;
  }

  // Has district: clean grouping
  if (district) {
    return `${year}|${season}|${category}|${district}`;
  }

  // No district: try to extract a stable key from sourceUrl filename
  if (contest.sourceUrl) {
    const fname = contest.sourceUrl.split("/").pop()
      .replace(/\.(pdf|PDF|htm|HTM)$/i, "")
      .replace(/_Rev\d+$/i, "")
      .replace(/_Revised$/i, "");
    // Strip category+round suffix to get event identifier
    const m = fname.match(/^(.+?)(PQT|DQT|QT|DCH|CH|SR)[FS]?$/i);
    if (m) {
      return `${year}|${season}|${category}|url:${m[1].toUpperCase()}`;
    }
    // Fallback: use full filename as key
    return `${year}|${season}|${category}|url:${fname.toUpperCase()}`;
  }

  // Fallback: each contest is its own event
  return `${year}|${season}|${category}|id:${contest.id}`;
}

function buildIndexes() {
  // Contests by ID
  contestsById = {};
  for (const c of bundle.contests) {
    contestsById[c.id] = c;
  }

  // Groups by ID (keys in bundle.groups are strings)
  groupsById = {};
  for (const [id, g] of Object.entries(bundle.groups)) {
    groupsById[id] = g;
  }

  // Judge index: normalized name → array of {contestId, role, district}
  judgeIndex = {};
  for (const contest of bundle.contests) {
    if (!contest.judges) continue;
    for (const j of contest.judges) {
      const key = normalizeName(j.name);
      if (!judgeIndex[key]) judgeIndex[key] = [];
      judgeIndex[key].push({
        contestId: contest.id,
        role: j.role,
        number: j.number,
        district: j.district,
        name: j.name,
      });
    }
  }

  // Arranger index: normalized name → array of {songName, groupId, contestId}
  arrangerIndex = {};
  for (const contest of bundle.contests) {
    if (!contest.scores) continue;
    for (const score of contest.scores) {
      if (!score.songs) continue;
      for (const song of score.songs) {
        if (!song.arranger) continue;
        const key = normalizeName(song.arranger);
        if (!arrangerIndex[key]) arrangerIndex[key] = [];
        arrangerIndex[key].push({
          songName: song.name,
          groupId: score.groupId,
          contestId: contest.id,
          name: song.arranger,
        });
      }
    }
  }

  // Member index: normalized name → array of {groupId, contestId, part, name}
  memberIndex = {};
  for (const contest of bundle.contests) {
    if (!contest.scores) continue;
    for (const score of contest.scores) {
      if (!score.members) continue;
      for (const m of score.members) {
        const key = normalizeName(m.name);
        if (!memberIndex[key]) memberIndex[key] = [];
        memberIndex[key].push({
          groupId: score.groupId,
          contestId: contest.id,
          part: m.part,
          name: m.name,
        });
      }
    }
  }

  // Build events index — group contest rounds into single events
  eventsIndex = {};
  for (const contest of bundle.contests) {
    const key = getEventKey(contest);
    if (!eventsIndex[key]) {
      eventsIndex[key] = {
        key,
        year: contest.year,
        season: contest.season,
        category: contest.category,
        district: contest.district,
        subEvent: contest.season === "International" ? getIntlSubEvent(contest.sourceUrl) : null,
        location: null,
        contests: [],
      };
    }
    eventsIndex[key].contests.push(contest);
    if (contest.location && !eventsIndex[key].location) {
      eventsIndex[key].location = contest.location;
    }
    if (contest.district && !eventsIndex[key].district) {
      eventsIndex[key].district = contest.district;
    }
  }

  // Deduplicate rounds within each event and sort by round order
  const roundOrder = { "QuarterFinal": 0, "SemiFinal": 1, "Final": 2 };
  for (const event of Object.values(eventsIndex)) {
    // Group by round
    const byRound = {};
    for (const c of event.contests) {
      const round = c.round || "_none";
      if (!byRound[round]) byRound[round] = [];
      byRound[round].push(c);
    }
    // For each round, keep the contest with the most scores (dedup)
    const deduped = [];
    for (const contests of Object.values(byRound)) {
      contests.sort((a, b) => (b.scores?.length || 0) - (a.scores?.length || 0));
      deduped.push(contests[0]);
    }
    // Sort: QuarterFinal → SemiFinal → Final → null
    deduped.sort((a, b) => (roundOrder[a.round] ?? 3) - (roundOrder[b.round] ?? 3));
    event.contests = deduped;
  }

  eventsArray = Object.values(eventsIndex)
    .sort((a, b) => b.year - a.year || (a.season || "").localeCompare(b.season || ""));
}

function normalizeName(name) {
  return (name || "").trim().toLowerCase();
}

function populateYearFilter() {
  const years = [...new Set(bundle.contests.map((c) => c.year))].sort((a, b) => b - a);
  const select = $("#year-filter");
  // Clear existing options except "All Years"
  select.innerHTML = '<option value="">All Years</option>';
  for (const y of years) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    select.appendChild(opt);
  }
}

// ── Filtering ───────────────────────────────────────────
function getFilteredEvents() {
  if (!bundle) return [];

  const query = $("#search").value.toLowerCase().trim();
  const yearVal = $("#year-filter").value;
  const seasonVal = $("#season-filter").value;
  const categoryVal = $("#category-filter").value;

  return eventsArray.filter((event) => {
    if (yearVal && String(event.year) !== yearVal) return false;
    if (seasonVal && event.season !== seasonVal) return false;
    if (categoryVal && event.category !== categoryVal) return false;
    if (query) {
      const haystack = event.contests.map((c) => {
        const groupNames = (c.scores || []).map((s) => {
          const g = groupsById[s.groupId];
          return g ? g.name : "";
        }).join(" ");
        return [c.location || "", c.season || "", c.category || "", c.round || "", event.district || "", groupNames].join(" ");
      }).join(" ").toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

// ── List Rendering ──────────────────────────────────────
function renderEventList(events) {
  const container = $("#contest-list");
  container.innerHTML = "";

  if (!events.length) {
    container.innerHTML = '<div class="empty-state">No contests found</div>';
    $("#contest-count").textContent = "0 contests";
    return;
  }

  for (const event of events) {
    const row = document.createElement("div");
    row.className = "item-row";

    // Year badge
    const yearBadge = document.createElement("div");
    yearBadge.className = "year-badge";
    yearBadge.textContent = event.year;
    row.appendChild(yearBadge);

    // Info
    const info = document.createElement("div");
    info.className = "item-info";

    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = getEventTitle(event);
    info.appendChild(title);

    const sub = document.createElement("span");
    sub.className = "item-sub";
    const loc = getEventLocation(event);
    const rounds = event.contests.map((c) => c.round).filter(Boolean);
    const parts = [];
    if (loc) parts.push(loc);
    if (rounds.length > 1) parts.push(rounds.join(" \u00b7 "));
    sub.textContent = parts.join(" \u2014 ");
    info.appendChild(sub);

    row.appendChild(info);

    // Winner pill (from finals)
    const winner = getEventWinner(event);
    if (winner) {
      const pill = document.createElement("span");
      pill.className = "winner-pill";
      pill.textContent = winner;
      row.appendChild(pill);
    }

    row.addEventListener("click", () => navigateTo("event", event.key));
    container.appendChild(row);
  }

  const n = events.length;
  $("#contest-count").textContent = `${n} event${n !== 1 ? "s" : ""}`;
}

function getWinner(contest) {
  if (!contest.scores || !contest.scores.length) return null;
  const first = contest.scores.find((s) => s.placement === 1);
  if (!first) return null;
  const group = groupsById[first.groupId];
  return group ? group.name : null;
}

function getEventTitle(event) {
  const parts = [];
  if (event.season) parts.push(event.season);
  if (event.district) parts.push(event.district);
  if (event.subEvent && event.subEvent !== "main") parts.push(event.subEvent);
  if (event.category) parts.push(event.category);
  return parts.join(" ") || "Contest";
}

function getEventLocation(event) {
  const loc = event.contests.map((c) => c.location).find(Boolean);
  if (!loc) return "";
  return loc.replace(/\n/g, ", ").replace(/,\s*Order\s*$/i, "").trim();
}

function getEventWinner(event) {
  // Prefer finals, then last round
  const finals = event.contests.filter((c) => c.round === "Final");
  const target = finals.length ? finals[finals.length - 1] : event.contests[event.contests.length - 1];
  return getWinner(target);
}

function refreshList() {
  renderEventList(getFilteredEvents());
}

// ── Event Detail ────────────────────────────────────────
function showEvent(eventKey) {
  const event = eventsIndex[eventKey];
  if (!event) return;

  // Title
  const titleParts = [event.year, getEventTitle(event)].filter(Boolean);
  $("#contest-title").textContent = titleParts.join(" ");

  // Location
  $("#contest-location").textContent = getEventLocation(event);

  // Date
  const dates = event.contests.map((c) => c.date).filter(Boolean);
  $("#contest-date").textContent = dates.length > 1
    ? `${dates[0]} \u2013 ${dates[dates.length - 1]}`
    : (dates[0] || "");

  // Source link — show only for single-round events
  const sourceLink = $("#contest-source-link");
  if (event.contests.length === 1 && event.contests[0].sourceUrl) {
    sourceLink.href = event.contests[0].sourceUrl;
    sourceLink.hidden = false;
  } else {
    sourceLink.hidden = true;
  }

  // Note
  const noteEl = $("#contest-note");
  const notes = event.contests.map((c) => c.note).filter(Boolean);
  if (notes.length) {
    noteEl.textContent = [...new Set(notes)].join("; ");
    noteEl.hidden = false;
  } else {
    noteEl.hidden = true;
  }

  // Render rounds into rounds-container
  const roundsContainer = $("#rounds-container");
  roundsContainer.innerHTML = "";

  for (const contest of event.contests) {
    const roundSection = document.createElement("div");
    roundSection.className = "round-section";

    // Round header (only if multi-round event)
    if (event.contests.length > 1 && contest.round) {
      const header = document.createElement("h3");
      header.className = "round-header";
      header.textContent = contest.round;
      if (contest.sourceUrl) {
        const link = document.createElement("a");
        link.className = "round-source-link";
        link.href = contest.sourceUrl;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "Source PDF";
        header.appendChild(document.createTextNode(" "));
        header.appendChild(link);
      }
      roundSection.appendChild(header);
    }

    // Scores table
    const scoresEl = document.createElement("div");
    scoresEl.className = "round-scores";
    renderScoresTableInto(scoresEl, contest);
    roundSection.appendChild(scoresEl);

    // Judges
    if (contest.judges && contest.judges.length) {
      const judgesEl = document.createElement("details");
      judgesEl.className = "content-section collapsible-section round-judges";
      renderJudgesInto(judgesEl, contest);
      roundSection.appendChild(judgesEl);
    }

    // Annotations
    if (contest.annotations && contest.annotations.length) {
      const annotEl = document.createElement("details");
      annotEl.className = "content-section collapsible-section round-annotations";
      renderAnnotationsInto(annotEl, contest);
      roundSection.appendChild(annotEl);
    }

    roundsContainer.appendChild(roundSection);
  }

  // Appearances — merge from all rounds
  renderAppearancesForEvent(event);

  GreatApp.showView("#contest-view");
}

function showContest(id) {
  // Find which event contains this contest and show the full event
  for (const event of Object.values(eventsIndex)) {
    if (event.contests.some((c) => c.id === Number(id) || c.id === id)) {
      navigateTo("event", event.key, { pushHistory: true });
      return;
    }
  }
}

function renderScoresTableInto(container, contest) {
  if (!contest.scores || !contest.scores.length) {
    container.innerHTML = '<div class="empty-state">No scores available</div>';
    return;
  }

  // Determine category columns from the first entry that has categories
  const catKeys = [];
  for (const s of contest.scores) {
    if (s.categories && Object.keys(s.categories).length) {
      catKeys.push(...Object.keys(s.categories));
      break;
    }
  }

  // Check if any score has songs
  const hasSongs = contest.scores.some(
    (s) => s.songs && s.songs.length > 0
  );

  // Build table
  let html = '<div class="scores-table-wrap"><table class="scores-table"><thead><tr>';
  html += "<th>Pl</th>";
  html += "<th>Group</th>";
  for (const cat of catKeys) {
    html += `<th class="col-num">${escHtml(cat)}</th>`;
  }
  html += '<th class="col-num">Total</th>';
  if (hasSongs) {
    html += "<th>Songs</th>";
  }
  html += "</tr></thead><tbody>";

  // Sort by placement (null/0 at end)
  const sorted = [...contest.scores].sort((a, b) => {
    const pa = a.placement || 9999;
    const pb = b.placement || 9999;
    return pa - pb;
  });

  for (const score of sorted) {
    const group = groupsById[score.groupId];
    const groupName = group ? group.name : `Group #${score.groupId}`;
    const plClass = placementClass(score.placement);

    html += "<tr>";
    html += `<td class="${plClass}">${score.placement || "\u2014"}</td>`;

    // Group cell — include member names if available
    let groupCell = `<span class="entity-link" data-type="group" data-id="${score.groupId}">${escHtml(groupName)}</span>`;
    if (score.members && score.members.length) {
      const memberLinks = score.members.map((m) =>
        `<span class="entity-link member-name" data-type="member" data-name="${escAttr(m.name)}">${escHtml(m.name)}</span>`
      ).join(", ");
      groupCell += `<div class="score-members">${memberLinks}</div>`;
    }
    html += `<td>${groupCell}</td>`;

    for (const cat of catKeys) {
      const val = score.categories ? score.categories[cat] : null;
      html += `<td class="col-num">${val != null ? val : "\u2014"}</td>`;
    }

    html += `<td class="col-num" style="font-weight:600">${score.total != null ? score.total : "\u2014"}</td>`;

    if (hasSongs) {
      const songParts = (score.songs || [])
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((s) => {
          let part = escHtml(s.name);
          if (s.arranger) {
            part += ` <span class="song-arranger">[<span class="entity-link" data-type="arranger" data-name="${escAttr(s.arranger)}">${escHtml(s.arranger)}</span>]</span>`;
          }
          return part;
        });
      html += `<td class="songs-cell">${songParts.join("; ")}</td>`;
    }

    html += "</tr>";
  }

  html += "</tbody></table></div>";
  container.innerHTML = html;
}

function renderJudgesInto(container, contest) {
  let html = "<summary>Judges</summary><div>";

  // Group by role
  const byRole = {};
  for (const j of contest.judges) {
    const role = j.role || "Other";
    if (!byRole[role]) byRole[role] = [];
    byRole[role].push(j);
  }

  for (const [role, judges] of Object.entries(byRole)) {
    html += `<div class="judge-role-group">`;
    html += `<div class="judge-role-label">${escHtml(role)}</div>`;
    for (const j of judges.sort((a, b) => (a.number || 0) - (b.number || 0))) {
      const districtStr = j.district ? `<span class="judge-district">(${escHtml(j.district)})</span>` : "";
      html += `<div class="judge-entry"><span class="entity-link" data-type="judge" data-name="${escAttr(j.name)}">${escHtml(j.name)}</span>${districtStr}</div>`;
    }
    html += "</div>";
  }

  html += "</div>";
  container.innerHTML = html;
}

function renderAnnotationsInto(container, contest) {
  let html = "<summary>Annotations</summary><div>";

  for (const a of contest.annotations) {
    const marker = a.marker ? `<span class="annotation-marker">${escHtml(a.marker)}</span>` : "";
    html += `<div class="annotation-item">${marker}${escHtml(a.text)}</div>`;
  }

  html += "</div>";
  container.innerHTML = html;
}

function renderAppearancesForEvent(event) {
  const section = $("#appearances-section");
  const content = $("#appearances-content");

  // Collect all appearances across rounds
  const allAppearances = [];
  for (const contest of event.contests) {
    if (contest.appearances && contest.appearances.length) {
      allAppearances.push(...contest.appearances);
    }
  }

  if (!allAppearances.length) {
    section.hidden = true;
    return;
  }

  const sorted = [...allAppearances].sort((a, b) => (a.order || 0) - (b.order || 0));

  let html = '<table class="appearances-table"><thead><tr>';
  html += "<th>#</th><th>Group</th>";
  const hasSession = sorted.some((a) => a.session);
  const hasTime = sorted.some((a) => a.time);
  if (hasSession) html += "<th>Session</th>";
  if (hasTime) html += "<th>Time</th>";
  html += "</tr></thead><tbody>";

  for (const app of sorted) {
    const group = groupsById[app.groupId];
    const groupName = group ? group.name : `Group #${app.groupId}`;
    html += "<tr>";
    html += `<td>${app.order || "\u2014"}</td>`;
    html += `<td><span class="entity-link" data-type="group" data-id="${app.groupId}">${escHtml(groupName)}</span></td>`;
    if (hasSession) html += `<td>${escHtml(app.session || "")}</td>`;
    if (hasTime) html += `<td>${escHtml(app.time || "")}</td>`;
    html += "</tr>";
  }

  html += "</tbody></table>";
  content.innerHTML = html;
  section.hidden = false;
}

// ── Group Detail ────────────────────────────────────────
function showGroup(groupId) {
  const group = groupsById[groupId];
  if (!group) return;

  $("#group-name").textContent = group.name;

  // Meta: type pill + location
  const metaEl = $("#group-meta");
  let metaHtml = "";
  if (group.type) {
    metaHtml += `<span class="group-type-pill">${escHtml(group.type)}</span>`;
  }
  const loc = [group.city, group.state].filter(Boolean).join(", ");
  if (loc) {
    metaHtml += `<span class="group-location">${escHtml(loc)}</span>`;
  }
  metaEl.innerHTML = metaHtml;

  // Find all contest appearances
  const appearances = [];
  for (const contest of bundle.contests) {
    if (!contest.scores) continue;
    for (const score of contest.scores) {
      if (String(score.groupId) === String(groupId)) {
        appearances.push({ contest, score });
      }
    }
  }

  // Sort by year DESC
  appearances.sort((a, b) => b.contest.year - a.contest.year);

  // Stats
  const statsEl = $("#group-stats");
  if (appearances.length) {
    const years = appearances.map((a) => a.contest.year);
    const bestFinish = Math.min(...appearances.map((a) => a.score.placement || 9999));
    const yearRange = `${Math.min(...years)}–${Math.max(...years)}`;

    statsEl.innerHTML = `
      <div class="stats-row">
        <div class="stat-item">
          <div class="stat-value">${appearances.length}</div>
          <div class="stat-label">Appearances</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${bestFinish <= 9998 ? ordinal(bestFinish) : "—"}</div>
          <div class="stat-label">Best Finish</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${yearRange}</div>
          <div class="stat-label">Years Active</div>
        </div>
      </div>`;
  } else {
    statsEl.innerHTML = "";
  }

  // Members — collect unique members across all appearances
  const membersEl = $("#group-members");
  const memberSet = {};  // normalized name → {name, parts: Set}
  for (const { score } of appearances) {
    if (!score.members) continue;
    for (const m of score.members) {
      const key = normalizeName(m.name);
      if (!memberSet[key]) memberSet[key] = { name: m.name, parts: new Set() };
      if (m.part) memberSet[key].parts.add(m.part);
    }
  }
  const memberNames = Object.values(memberSet);
  if (memberNames.length) {
    const memberHtml = memberNames.map((m) => {
      const partStr = m.parts.size ? ` <span class="member-part-tag">${escHtml([...m.parts].join(", "))}</span>` : "";
      return `<span class="entity-link" data-type="member" data-name="${escAttr(m.name)}">${escHtml(m.name)}</span>${partStr}`;
    }).join(" · ");
    membersEl.innerHTML = `<div class="group-members-label">Members</div><div class="group-members-list">${memberHtml}</div>`;
    membersEl.hidden = false;
  } else {
    membersEl.hidden = true;
  }

  // History table
  const histEl = $("#group-history");
  if (!appearances.length) {
    histEl.innerHTML = '<div class="empty-state">No contest history found</div>';
  } else {
    let html = '<table class="history-table"><thead><tr>';
    html += "<th>Year</th><th>Season</th><th>Category</th><th>Round</th><th>Pl</th><th>Total</th>";
    html += "</tr></thead><tbody>";

    for (const { contest, score } of appearances) {
      const plClass = placementClass(score.placement);
      html += `<tr data-contest-id="${contest.id}">`;
      html += `<td>${contest.year}</td>`;
      html += `<td>${escHtml(contest.season || "")}</td>`;
      html += `<td>${escHtml(contest.category || "")}</td>`;
      html += `<td>${escHtml(contest.round || "")}</td>`;
      html += `<td class="${plClass}">${score.placement || "—"}</td>`;
      html += `<td>${score.total != null ? score.total : "—"}</td>`;
      html += "</tr>";
    }

    html += "</tbody></table>";
    histEl.innerHTML = html;
  }

  GreatApp.showView("#group-view");
}

// ── Judge Detail ────────────────────────────────────────
function showJudge(name) {
  const key = normalizeName(name);
  const entries = judgeIndex[key];
  if (!entries || !entries.length) return;

  // Use the display name from the first entry
  const displayName = entries[0].name;
  $("#judge-name").textContent = displayName;

  // District pill — use the most common district
  const metaEl = $("#judge-meta");
  const districts = entries.map((e) => e.district).filter(Boolean);
  const topDistrict = mode(districts);
  if (topDistrict) {
    metaEl.innerHTML = `<span class="judge-district-pill">${escHtml(topDistrict)}</span>`;
  } else {
    metaEl.innerHTML = "";
  }

  // History table
  const histEl = $("#judge-history");
  // Sort by year DESC
  const sorted = [...entries].sort((a, b) => {
    const ca = contestsById[a.contestId];
    const cb = contestsById[b.contestId];
    return (cb ? cb.year : 0) - (ca ? ca.year : 0);
  });

  let html = '<table class="history-table"><thead><tr>';
  html += "<th>Year</th><th>Season</th><th>Category</th><th>Round</th><th>Role</th>";
  html += "</tr></thead><tbody>";

  for (const entry of sorted) {
    const contest = contestsById[entry.contestId];
    if (!contest) continue;
    html += `<tr data-contest-id="${contest.id}">`;
    html += `<td>${contest.year}</td>`;
    html += `<td>${escHtml(contest.season || "")}</td>`;
    html += `<td>${escHtml(contest.category || "")}</td>`;
    html += `<td>${escHtml(contest.round || "")}</td>`;
    html += `<td>${escHtml(entry.role || "")}</td>`;
    html += "</tr>";
  }

  html += "</tbody></table>";
  histEl.innerHTML = html;

  GreatApp.showView("#judge-view");
}

// ── Arranger Detail ────────────────────────────────────
function showArranger(name) {
  const key = normalizeName(name);
  const entries = arrangerIndex[key];
  if (!entries || !entries.length) return;

  const displayName = entries[0].name;
  $("#arranger-name").textContent = displayName;

  // Stats
  const uniqueSongs = [...new Set(entries.map((e) => e.songName))];
  const uniqueGroups = [...new Set(entries.map((e) => e.groupId))];
  const statsEl = $("#arranger-stats");
  statsEl.innerHTML = `
    <div class="stats-row">
      <div class="stat-item">
        <div class="stat-value">${uniqueSongs.length}</div>
        <div class="stat-label">Songs</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${uniqueGroups.length}</div>
        <div class="stat-label">Groups</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${entries.length}</div>
        <div class="stat-label">Performances</div>
      </div>
    </div>`;

  // Songs table grouped by song name
  const songMap = {};
  for (const entry of entries) {
    if (!songMap[entry.songName]) songMap[entry.songName] = [];
    songMap[entry.songName].push(entry);
  }

  let html = "";
  for (const [songName, performances] of Object.entries(songMap).sort((a, b) => a[0].localeCompare(b[0]))) {
    html += `<div class="arranger-song-group">`;
    html += `<div class="arranger-song-title">${escHtml(songName)}</div>`;
    html += `<table class="history-table"><thead><tr>`;
    html += `<th>Year</th><th>Group</th><th>Season</th><th>Category</th><th>Round</th>`;
    html += `</tr></thead><tbody>`;

    // Sort performances by year DESC
    const sorted = [...performances].sort((a, b) => {
      const ca = contestsById[a.contestId];
      const cb = contestsById[b.contestId];
      return (cb ? cb.year : 0) - (ca ? ca.year : 0);
    });

    for (const perf of sorted) {
      const contest = contestsById[perf.contestId];
      if (!contest) continue;
      const group = groupsById[perf.groupId];
      const groupName = group ? group.name : "Unknown";
      html += `<tr data-contest-id="${contest.id}">`;
      html += `<td>${contest.year}</td>`;
      html += `<td><span class="entity-link" data-type="group" data-id="${perf.groupId}">${escHtml(groupName)}</span></td>`;
      html += `<td>${escHtml(contest.season || "")}</td>`;
      html += `<td>${escHtml(contest.category || "")}</td>`;
      html += `<td>${escHtml(contest.round || "")}</td>`;
      html += `</tr>`;
    }

    html += `</tbody></table></div>`;
  }

  $("#arranger-songs").innerHTML = html;
  GreatApp.showView("#arranger-view");
}

// ── Member Detail ──────────────────────────────────────
function showMember(name) {
  const key = normalizeName(name);
  const entries = memberIndex[key];
  if (!entries || !entries.length) return;

  const displayName = entries[0].name;
  $("#member-name").textContent = displayName;

  // Part pill — use the most common part
  const metaEl = $("#member-meta");
  const parts = entries.map((e) => e.part).filter(Boolean);
  const topPart = mode(parts);
  if (topPart) {
    metaEl.innerHTML = `<span class="member-part-pill">${escHtml(topPart)}</span>`;
  } else {
    metaEl.innerHTML = "";
  }

  // Deduplicate by group — collect unique groups with their contest history
  const groupMap = {};
  for (const entry of entries) {
    const gid = entry.groupId;
    if (!groupMap[gid]) groupMap[gid] = [];
    groupMap[gid].push(entry);
  }

  // Stats
  const uniqueGroups = Object.keys(groupMap);
  const years = entries.map((e) => {
    const c = contestsById[e.contestId];
    return c ? c.year : null;
  }).filter(Boolean);
  const statsEl = $("#member-stats");
  statsEl.innerHTML = `
    <div class="stats-row">
      <div class="stat-item">
        <div class="stat-value">${uniqueGroups.length}</div>
        <div class="stat-label">Group${uniqueGroups.length !== 1 ? "s" : ""}</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${entries.length}</div>
        <div class="stat-label">Contest Appearances</div>
      </div>
      ${years.length ? `<div class="stat-item">
        <div class="stat-value">${Math.min(...years)}–${Math.max(...years)}</div>
        <div class="stat-label">Years Active</div>
      </div>` : ""}
    </div>`;

  // History table grouped by group
  let html = "";
  for (const gid of uniqueGroups) {
    const group = groupsById[gid];
    const groupName = group ? group.name : `Group #${gid}`;
    const gEntries = groupMap[gid];

    html += `<div class="member-group-section">`;
    html += `<div class="member-group-title"><span class="entity-link" data-type="group" data-id="${gid}">${escHtml(groupName)}</span></div>`;
    html += `<table class="history-table"><thead><tr>`;
    html += `<th>Year</th><th>Season</th><th>Category</th><th>Round</th><th>Pl</th><th>Part</th>`;
    html += `</tr></thead><tbody>`;

    // Sort by year DESC
    const sorted = [...gEntries].sort((a, b) => {
      const ca = contestsById[a.contestId];
      const cb = contestsById[b.contestId];
      return (cb ? cb.year : 0) - (ca ? ca.year : 0);
    });

    for (const entry of sorted) {
      const contest = contestsById[entry.contestId];
      if (!contest) continue;
      // Find the score for this group in this contest to get placement
      const score = (contest.scores || []).find((s) => String(s.groupId) === String(gid));
      const pl = score ? score.placement : null;
      const plClass = placementClass(pl);

      html += `<tr data-contest-id="${contest.id}">`;
      html += `<td>${contest.year}</td>`;
      html += `<td>${escHtml(contest.season || "")}</td>`;
      html += `<td>${escHtml(contest.category || "")}</td>`;
      html += `<td>${escHtml(contest.round || "")}</td>`;
      html += `<td class="${plClass}">${pl || "—"}</td>`;
      html += `<td>${escHtml(entry.part || "")}</td>`;
      html += `</tr>`;
    }

    html += `</tbody></table></div>`;
  }

  $("#member-history").innerHTML = html;
  GreatApp.showView("#member-view");
}

// ── Navigation ──────────────────────────────────────────
function navigateTo(type, id, { pushHistory = true } = {}) {
  const hash = `#${type}/${encodeURIComponent(id)}`;

  if (pushHistory) {
    history.pushState({ type, id }, "", hash);
  }

  switch (type) {
    case "event":
      showEvent(id);
      break;
    case "contest":
      showContest(id);
      break;
    case "group":
      showGroup(id);
      break;
    case "judge":
      showJudge(id);
      break;
    case "arranger":
      showArranger(id);
      break;
    case "member":
      showMember(id);
      break;
    default:
      showListView();
  }

  // Scroll to top on navigation
  window.scrollTo(0, 0);
}

function showListView({ pushHistory = true } = {}) {
  if (pushHistory) {
    history.pushState(null, "", window.location.pathname);
  }
  GreatApp.showView("#list-view");
  refreshList();
}

function navigateToHash(hash, pushHistory) {
  if (!hash || hash === "#") {
    showListView({ pushHistory });
    return;
  }

  const parts = hash.slice(1).split("/");
  const type = parts[0];
  const id = decodeURIComponent(parts.slice(1).join("/"));

  if (type && id) {
    navigateTo(type, id, { pushHistory });
  }
}

// ── Event Delegation (entity links + history rows) ──────
document.addEventListener("click", (e) => {
  // Entity links
  const entityLink = e.target.closest(".entity-link");
  if (entityLink) {
    e.preventDefault();
    e.stopPropagation();
    const type = entityLink.dataset.type;
    if (type === "group") {
      navigateTo("group", entityLink.dataset.id);
    } else if (type === "judge") {
      navigateTo("judge", entityLink.dataset.name);
    } else if (type === "arranger") {
      navigateTo("arranger", entityLink.dataset.name);
    } else if (type === "member") {
      navigateTo("member", entityLink.dataset.name);
    }
    return;
  }

  // History table rows (group detail + judge detail)
  const histRow = e.target.closest(".history-table tbody tr[data-contest-id]");
  if (histRow) {
    navigateTo("contest", Number(histRow.dataset.contestId));
    return;
  }
});

// ── Helpers ─────────────────────────────────────────────
function placementClass(pl) {
  if (pl === 1) return "pl-gold";
  if (pl === 2) return "pl-silver";
  if (pl === 3) return "pl-bronze";
  return "";
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(str) {
  return escHtml(str).replace(/'/g, "&#39;");
}

function mode(arr) {
  if (!arr.length) return null;
  const counts = {};
  let maxVal = null;
  let maxCount = 0;
  for (const v of arr) {
    counts[v] = (counts[v] || 0) + 1;
    if (counts[v] > maxCount) {
      maxCount = counts[v];
      maxVal = v;
    }
  }
  return maxVal;
}

// ── Service Worker ──────────────────────────────────────
GreatApp.registerSW("sw.js");

// ── Init ────────────────────────────────────────────────
function init() {
  // Filter listeners
  $("#search").addEventListener("input", refreshList);
  $("#year-filter").addEventListener("change", refreshList);
  $("#season-filter").addEventListener("change", refreshList);
  $("#category-filter").addEventListener("change", refreshList);

  // Back buttons
  $("#contest-back-btn").addEventListener("click", () => history.back());
  $("#group-back-btn").addEventListener("click", () => history.back());
  $("#judge-back-btn").addEventListener("click", () => history.back());
  $("#arranger-back-btn").addEventListener("click", () => history.back());
  $("#member-back-btn").addEventListener("click", () => history.back());

  // Search toggle (framework helper)
  GreatApp.initSearchToggle("#search-toggle", "#search-bar", "#search");

  // Keyboard shortcuts (framework helper)
  GreatApp.initKeyboard({ searchSel: "#search", detailViewSel: "#contest-view" });

  // Browser back/forward
  window.addEventListener("popstate", (e) => {
    if (e.state && e.state.type && e.state.id) {
      navigateTo(e.state.type, e.state.id, { pushHistory: false });
    } else {
      showListView({ pushHistory: false });
    }
  });

  // Load data
  loadBundle();
}

init();
