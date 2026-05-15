// Great Trove — Barbershop Contest Scoresheet Browser

const $ = GreatApp.$;

// ── State ───────────────────────────────────────────────
let bundle = null;          // raw bundle data
let contestsById = {};      // id → contest
let groupsById = {};        // id → group object
let judgeIndex = {};        // normalized name → [{contest, role, district}]
let arrangerIndex = {};     // normalized name → {displayName, entries: [{songName, groupId, contestId}]}
let memberIndex = {};       // normalized name → [{groupId, contestId, part, name}]
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
function getFilteredContests() {
  if (!bundle) return [];

  const query = $("#search").value.toLowerCase().trim();
  const yearVal = $("#year-filter").value;
  const seasonVal = $("#season-filter").value;
  const categoryVal = $("#category-filter").value;

  return bundle.contests.filter((c) => {
    if (yearVal && String(c.year) !== yearVal) return false;
    if (seasonVal && c.season !== seasonVal) return false;
    if (categoryVal && c.category !== categoryVal) return false;
    if (query) {
      // Search group names and location
      const groupNames = (c.scores || [])
        .map((s) => {
          const g = groupsById[s.groupId];
          return g ? g.name : "";
        })
        .join(" ");
      const haystack = [
        c.location || "",
        c.season || "",
        c.category || "",
        c.round || "",
        groupNames,
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    }
    return true;
  }).sort((a, b) => b.year - a.year || (a.season || "").localeCompare(b.season || ""));
}

// ── List Rendering ──────────────────────────────────────
function renderContestList(contests) {
  const container = $("#contest-list");
  container.innerHTML = "";

  if (!contests.length) {
    container.innerHTML = '<div class="empty-state">No contests found</div>';
    $("#contest-count").textContent = "0 contests";
    return;
  }

  for (const contest of contests) {
    const row = document.createElement("div");
    row.className = "item-row";
    row.dataset.id = contest.id;

    // Year badge
    const yearBadge = document.createElement("div");
    yearBadge.className = "year-badge";
    yearBadge.textContent = contest.year;
    row.appendChild(yearBadge);

    // Info
    const info = document.createElement("div");
    info.className = "item-info";

    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = [contest.season, contest.category, contest.round]
      .filter(Boolean)
      .join(" ");
    info.appendChild(title);

    const sub = document.createElement("span");
    sub.className = "item-sub";
    sub.textContent = contest.location || "";
    info.appendChild(sub);

    row.appendChild(info);

    // Winner pill
    const winner = getWinner(contest);
    if (winner) {
      const pill = document.createElement("span");
      pill.className = "winner-pill";
      pill.textContent = winner;
      row.appendChild(pill);
    }

    row.addEventListener("click", () => navigateTo("contest", contest.id));
    container.appendChild(row);
  }

  const n = contests.length;
  $("#contest-count").textContent = `${n} contest${n !== 1 ? "s" : ""}`;
}

function getWinner(contest) {
  if (!contest.scores || !contest.scores.length) return null;
  const first = contest.scores.find((s) => s.placement === 1);
  if (!first) return null;
  const group = groupsById[first.groupId];
  return group ? group.name : null;
}

function refreshList() {
  renderContestList(getFilteredContests());
}

// ── Contest Detail ──────────────────────────────────────
function showContest(id) {
  const contest = contestsById[id];
  if (!contest) return;

  // Title
  const titleParts = [contest.year, contest.season, contest.category, contest.round]
    .filter(Boolean);
  $("#contest-title").textContent = titleParts.join(" ");

  // Meta
  $("#contest-location").textContent = contest.location || "";
  $("#contest-date").textContent = contest.date || "";

  // Source link
  const sourceLink = $("#contest-source-link");
  if (contest.sourceUrl) {
    sourceLink.href = contest.sourceUrl;
    sourceLink.hidden = false;
  } else {
    sourceLink.hidden = true;
  }

  // Note
  const noteEl = $("#contest-note");
  if (contest.note) {
    noteEl.textContent = contest.note;
    noteEl.hidden = false;
  } else {
    noteEl.hidden = true;
  }

  // Scores table
  renderScoresTable(contest);

  // Judges
  renderJudges(contest);

  // Annotations
  renderAnnotations(contest);

  // Appearances
  renderAppearances(contest);

  GreatApp.showView("#contest-view");
}

function renderScoresTable(contest) {
  const section = $("#scores-section");
  if (!contest.scores || !contest.scores.length) {
    section.innerHTML = '<div class="empty-state">No scores available</div>';
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
  html += '<th>Pl</th>';
  html += '<th>Group</th>';
  for (const cat of catKeys) {
    html += `<th class="col-num">${escHtml(cat)}</th>`;
  }
  html += '<th class="col-num">Total</th>';
  if (hasSongs) {
    html += '<th>Songs</th>';
  }
  html += '</tr></thead><tbody>';

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
    html += `<td class="${plClass}">${score.placement || "—"}</td>`;

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
      html += `<td class="col-num">${val != null ? val : "—"}</td>`;
    }

    html += `<td class="col-num" style="font-weight:600">${score.total != null ? score.total : "—"}</td>`;

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
  section.innerHTML = html;
}

function renderJudges(contest) {
  const section = $("#judges-section");
  const content = $("#judges-content");

  if (!contest.judges || !contest.judges.length) {
    section.hidden = true;
    return;
  }

  // Group by role
  const byRole = {};
  for (const j of contest.judges) {
    const role = j.role || "Other";
    if (!byRole[role]) byRole[role] = [];
    byRole[role].push(j);
  }

  let html = "";
  for (const [role, judges] of Object.entries(byRole)) {
    html += `<div class="judge-role-group">`;
    html += `<div class="judge-role-label">${escHtml(role)}</div>`;
    for (const j of judges.sort((a, b) => (a.number || 0) - (b.number || 0))) {
      const districtStr = j.district ? `<span class="judge-district">(${escHtml(j.district)})</span>` : "";
      html += `<div class="judge-entry"><span class="entity-link" data-type="judge" data-name="${escAttr(j.name)}">${escHtml(j.name)}</span>${districtStr}</div>`;
    }
    html += "</div>";
  }

  content.innerHTML = html;
  section.hidden = false;
}

function renderAnnotations(contest) {
  const section = $("#annotations-section");
  const content = $("#annotations-content");

  if (!contest.annotations || !contest.annotations.length) {
    section.hidden = true;
    return;
  }

  let html = "";
  for (const a of contest.annotations) {
    const marker = a.marker ? `<span class="annotation-marker">${escHtml(a.marker)}</span>` : "";
    html += `<div class="annotation-item">${marker}${escHtml(a.text)}</div>`;
  }

  content.innerHTML = html;
  section.hidden = false;
}

function renderAppearances(contest) {
  const section = $("#appearances-section");
  const content = $("#appearances-content");

  if (!contest.appearances || !contest.appearances.length) {
    section.hidden = true;
    return;
  }

  const sorted = [...contest.appearances].sort((a, b) => (a.order || 0) - (b.order || 0));

  let html = '<table class="appearances-table"><thead><tr>';
  html += "<th>#</th><th>Group</th>";
  // Only show session/time if present
  const hasSession = sorted.some((a) => a.session);
  const hasTime = sorted.some((a) => a.time);
  if (hasSession) html += "<th>Session</th>";
  if (hasTime) html += "<th>Time</th>";
  html += "</tr></thead><tbody>";

  for (const app of sorted) {
    const group = groupsById[app.groupId];
    const groupName = group ? group.name : `Group #${app.groupId}`;
    html += "<tr>";
    html += `<td>${app.order || "—"}</td>`;
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
