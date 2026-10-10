// ==========================================
// connor.fm — data store (KV + cache, works on the free plan)
//
// Access codes, listening sessions, plays, comments, questions
// and page views, stored in the existing KV namespace.
//
// The free plan allows 1,000 KV writes per day, so this file is
// careful with writes:
//   - rate limits only use the cache (no writes at all)
//   - page views are collected in the cache and written to KV
//     every few minutes, with a daily maximum so stats can never
//     use up the writes needed for saving content
// ==========================================

const DAY = 24 * 60 * 60 * 1000;

// Page views: write the collected numbers at most every 5 minutes
// (or every 25 views), and never more than 250 times per day.
const STATS_FLUSH_MS = 5 * 60 * 1000;
const STATS_FLUSH_HITS = 25;
const STATS_MAX_WRITES = 250;

const MAX_COMMENTS = 2000;
const MAX_QUESTIONS = 500;
const RECENT_EVENTS = 40;

// Cache keys need a URL. This host is never requested, it only names entries.
const CACHE_HOST = "https://cache.connor.fm";


export function createStore(env) {
  const kv = env.CONNOR_DATA;
  const cache = typeof caches !== "undefined" ? caches.default : null;

  const readJson = async (key, fallback) => (await kv.get(key, { type: "json" })) ?? fallback;
  const writeJson = (key, value, options) => kv.put(key, JSON.stringify(value), options);


  // ---------- cache helpers ----------

  const cacheRequest = path => new Request(`${CACHE_HOST}/${path}`);

  async function cacheGet(path) {
    if (!cache) {
      return null;
    }

    const response = await cache.match(cacheRequest(path));
    return response ? response.json() : null;
  }

  async function cachePut(path, value, seconds) {
    if (!cache) {
      return;
    }

    await cache.put(
      cacheRequest(path),
      new Response(JSON.stringify(value), {
        headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${seconds}` }
      })
    );
  }


  // ---------- access codes ----------

  const readCodes = () => readJson("codes", []);
  const activityKey = id => `activity:${id}`;

  const emptyActivity = () => ({ unlocks: 0, plays: 0, completes: 0, last_seen: null, tracks: {}, recent: [] });


  return {
    // Per data center, kept in the cache — good enough to stop guessing and spam.
    async rateLimit(key, max, windowSeconds) {
      const path = `rate/${encodeURIComponent(key)}`;
      const entry = (await cacheGet(path)) || { count: 0, reset: Date.now() + windowSeconds * 1000 };

      if (entry.reset <= Date.now()) {
        entry.count = 0;
        entry.reset = Date.now() + windowSeconds * 1000;
      }

      if (entry.count >= max) {
        return false;
      }

      entry.count += 1;
      await cachePut(path, entry, Math.max(1, Math.ceil((entry.reset - Date.now()) / 1000)));

      return true;
    },


    // ---------- page views ----------

    async hit(path, visitorHash) {
      const day = isoDay(Date.now());
      const visitorPath = `visitor/${day}/${visitorHash}`;
      const isNewVisitor = !(await cacheGet(visitorPath));

      if (isNewVisitor) {
        await cachePut(visitorPath, 1, 26 * 60 * 60);
      }

      const bufferPath = `stats-buffer/${day}`;
      const buffer = (await cacheGet(bufferPath)) || { views: {}, visitors: 0, hits: 0, since: Date.now() };

      buffer.views[path] = (buffer.views[path] || 0) + 1;
      buffer.visitors += isNewVisitor ? 1 : 0;
      buffer.hits += 1;

      if (buffer.hits >= STATS_FLUSH_HITS || Date.now() - buffer.since >= STATS_FLUSH_MS) {
        await this.flushStats(day, buffer);
        await cachePut(bufferPath, { views: {}, visitors: 0, hits: 0, since: Date.now() }, 26 * 60 * 60);
      } else {
        await cachePut(bufferPath, buffer, 26 * 60 * 60);
      }
    },


    // Adds collected views to the day's numbers in KV.
    async flushStats(day, buffer) {
      if (!buffer || buffer.hits === 0) {
        return;
      }

      const key = `stats:${day}`;
      const stats = await readJson(key, { views: {}, visitors: 0, writes: 0 });

      if (stats.writes >= STATS_MAX_WRITES) {
        return;
      }

      for (const [path, count] of Object.entries(buffer.views)) {
        stats.views[path] = (stats.views[path] || 0) + count;
      }

      stats.visitors += buffer.visitors;
      stats.writes += 1;

      // Keep daily numbers for about a year.
      await writeJson(key, stats, { expirationTtl: 400 * 24 * 60 * 60 });
    },


    async stats(days) {
      // Write what this data center collected so far, so the numbers are fresh.
      const today = isoDay(Date.now());
      const bufferPath = `stats-buffer/${today}`;
      const buffer = await cacheGet(bufferPath);

      if (buffer?.hits) {
        await this.flushStats(today, buffer);
        await cachePut(bufferPath, { views: {}, visitors: 0, hits: 0, since: Date.now() }, 26 * 60 * 60);
      }

      const dayList = Array.from({ length: days }, (_, index) => isoDay(Date.now() - (days - 1 - index) * DAY));
      const values = await Promise.all(dayList.map(day => readJson(`stats:${day}`, null)));

      const pages = {};
      let limited = false;

      const daily = dayList
        .map((day, index) => {
          const stats = values[index];

          if (!stats) {
            return null;
          }

          limited ||= stats.writes >= STATS_MAX_WRITES;

          for (const [path, count] of Object.entries(stats.views)) {
            pages[path] = (pages[path] || 0) + count;
          }

          return {
            day,
            views: Object.values(stats.views).reduce((sum, count) => sum + count, 0),
            visitors: stats.visitors
          };
        })
        .filter(Boolean);

      // Plays per track, from all access codes (all time).
      const codes = await readCodes();
      const activities = await Promise.all(codes.map(code => readJson(activityKey(code.id), emptyActivity())));
      const tracks = {};
      let unlocks = 0;

      activities.forEach(activity => {
        unlocks += activity.unlocks;

        for (const [track, entry] of Object.entries(activity.tracks)) {
          const total = (tracks[track] ||= { track, title: entry.title, plays: 0, completes: 0, listeners: 0 });
          total.plays += entry.plays;
          total.completes += entry.completes;
          total.listeners += entry.plays > 0 ? 1 : 0;
        }
      });

      return {
        daily,
        pages: Object.entries(pages)
          .map(([path, views]) => ({ path, views }))
          .sort((a, b) => b.views - a.views),
        tracks: Object.values(tracks).sort((a, b) => b.plays - a.plays),
        unlocks,
        limited
      };
    },


    // ---------- access codes ----------

    async listCodes() {
      const codes = await readCodes();
      const activities = await Promise.all(codes.map(code => readJson(activityKey(code.id), emptyActivity())));

      return codes
        .map((code, index) => ({
          ...code,
          active: code.active ? 1 : 0,
          unlocks: activities[index].unlocks,
          plays: activities[index].plays,
          completes: activities[index].completes,
          last_seen: activities[index].last_seen
        }))
        .sort((a, b) => b.created - a.created);
    },


    async createCode(label, code) {
      const codes = await readCodes();

      if (codes.some(existing => existing.code === code)) {
        return { error: "This code already exists." };
      }

      const id = crypto.randomUUID();

      codes.push({ id, label, code, active: true, created: Date.now() });
      await writeJson("codes", codes);

      return { id };
    },


    async updateCode(id, { label, active }) {
      const codes = await readCodes();
      const code = codes.find(item => item.id === id);

      if (!code) {
        return;
      }

      if (typeof label === "string" && label) {
        code.label = label;
      }

      if (typeof active === "boolean") {
        code.active = active;
      }

      await writeJson("codes", codes);
    },


    async deleteCode(id) {
      const codes = await readCodes();

      await writeJson("codes", codes.filter(code => code.id !== id));
      await kv.delete(activityKey(id));
    },


    async codeCount() {
      return (await readCodes()).length;
    },


    async codeActivity(id) {
      const activity = await readJson(activityKey(id), emptyActivity());

      return {
        tracks: Object.entries(activity.tracks)
          .map(([track, entry]) => ({ track, ...entry }))
          .sort((a, b) => b.last - a.last),
        recent: activity.recent
      };
    },


    // Opens a listening session for a code. Returns null for unknown or paused codes.
    async unlock(code, token, ttlSeconds) {
      const match = (await readCodes()).find(item => item.code === code && item.active);

      if (!match) {
        return null;
      }

      await kv.put(`listen:${token}`, match.id, { expirationTtl: ttlSeconds });
      await this.logEvent("unlock", match.id);

      return match.id;
    },


    // The code behind a listening session, if the session and the code are still valid.
    // (Pausing a code can take up to a minute to reach every data center.)
    async sessionCode(token) {
      const codeId = await kv.get(`listen:${token}`);

      if (!codeId) {
        return null;
      }

      const code = (await readCodes()).find(item => item.id === codeId);

      return code?.active ? codeId : null;
    },


    async logEvent(type, codeId, track = null, title = null) {
      const key = activityKey(codeId);
      const activity = await readJson(key, emptyActivity());
      const now = Date.now();

      activity.last_seen = now;
      activity.recent = [{ ts: now, type, title }, ...activity.recent].slice(0, RECENT_EVENTS);

      if (type === "unlock") {
        activity.unlocks += 1;
      }

      if (track && (type === "play" || type === "complete")) {
        const entry = (activity.tracks[track] ||= { title, plays: 0, completes: 0, last: now });

        entry.title = title;
        entry.last = now;
        entry[type === "play" ? "plays" : "completes"] += 1;
        activity[type === "play" ? "plays" : "completes"] += 1;
      }

      try {
        await writeJson(key, activity);
      } catch (error) {
        // KV allows one write per second per key; losing one event is fine.
        console.error("Could not log event:", error);
      }
    },


    // ---------- comments ----------

    async listComments(withCode = false) {
      const comments = await readJson("comments", []);
      const sorted = [...comments].sort((a, b) => b.ts - a.ts);

      if (!withCode) {
        return sorted.map(({ id, ts, track, at, name, text }) => ({ id, ts, track, at, name, text }));
      }

      const labels = Object.fromEntries((await readCodes()).map(code => [code.id, code.label]));

      return sorted.map(comment => ({ ...comment, code_label: labels[comment.code_id] || null }));
    },


    async addComment({ track, at, name, text, codeId }) {
      const comments = await readJson("comments", []);
      const comment = { id: crypto.randomUUID(), ts: Date.now(), track, at, name, text, code_id: codeId };

      comments.push(comment);
      await writeJson("comments", comments.slice(-MAX_COMMENTS));

      return { id: comment.id, ts: comment.ts, track, at, name, text };
    },


    async deleteComment(id) {
      const comments = await readJson("comments", []);
      await writeJson("comments", comments.filter(comment => comment.id !== id));
    },


    // ---------- questions ----------

    async addQuestion(text) {
      const questions = await readJson("questions", []);

      if (questions.filter(question => !question.answer).length >= MAX_QUESTIONS) {
        return { error: "The inbox is full right now. Try again later." };
      }

      questions.push({ id: crypto.randomUUID(), ts: Date.now(), text, answer: "", published: 0, answered: null });
      await writeJson("questions", questions);

      return {};
    },


    async listQuestions(publishedOnly) {
      const questions = await readJson("questions", []);

      if (publishedOnly) {
        return questions
          .filter(question => question.published && question.answer)
          .map(({ id, ts, text, answer, answered }) => ({ id, ts, text, answer, answered }))
          .sort((a, b) => (b.answered || 0) - (a.answered || 0));
      }

      return [...questions].sort((a, b) => b.ts - a.ts);
    },


    async updateQuestion(id, { answer, published }) {
      const questions = await readJson("questions", []);
      const question = questions.find(item => item.id === id);

      if (!question) {
        return;
      }

      if (typeof answer === "string") {
        question.answer = answer;
        question.answered = answer ? question.answered || Date.now() : null;
      }

      if (typeof published === "boolean") {
        question.published = published ? 1 : 0;
      }

      await writeJson("questions", questions);
    },


    async deleteQuestion(id) {
      const questions = await readJson("questions", []);
      await writeJson("questions", questions.filter(question => question.id !== id));
    }
  };
}


function isoDay(time) {
  return new Date(time).toISOString().slice(0, 10);
}
