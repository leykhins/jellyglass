/*
 * jellyglass — optional script that adds the parts of the design CSS can't draw:
 *   - My Media tiles: each library's three newest posters and its item count
 *   - Hero slider: clickable slide bars
 *   - Title pages: season tabs and an episode list beside the series info
 *   - Phones: a bottom tab bar with Home, your libraries and Search
 *   - Sign in: coloured initials on the profile circles and a wall of your posters behind them
 *   - Dashboard: loads the theme there (Jellyfin leaves Custom CSS out) plus the page captions
 * The client theme works without it. Install with the JavaScript Injector plugin.
 */
(function () {
  "use strict";

  // What each library type counts, and how to label it
  var KINDS = {
    movies: { types: "Movie", one: "movie", many: "movies" },
    tvshows: { types: "Series", one: "show", many: "shows" },
    boxsets: { types: "BoxSet", one: "collection", many: "collections" },
    music: { types: "MusicAlbum", one: "album", many: "albums", square: true },
    books: { types: "Book", one: "book", many: "books" },
    homevideos: { types: "Video,Photo", one: "item", many: "items" },
    musicvideos: { types: "MusicVideo", one: "video", many: "videos" },
  };

  var cache = {};

  function api() {
    return window.ApiClient;
  }

  function fetchLibrary(card) {
    var id = card.getAttribute("data-id");
    var kind = KINDS[card.getAttribute("data-collectiontype")];
    if (!kind) return Promise.resolve(null);
    if (cache[id]) return cache[id];

    var client = api();
    var url = client.getUrl("Items", {
      userId: client.getCurrentUserId(),
      parentId: id,
      recursive: true,
      includeItemTypes: kind.types,
      sortBy: "DateCreated",
      sortOrder: "Descending",
      imageTypes: "Primary",
      fields: "PrimaryImageAspectRatio",
      limit: 3,
      enableTotalRecordCount: true,
    });

    cache[id] = client.getJSON(url).then(function (res) {
      var n = res.TotalRecordCount || 0;
      // Anime libraries are TV libraries, but the design counts them as series
      var isAnime = /anime/i.test(card.getAttribute("data-path") || "");
      var many = isAnime && kind.types === "Series" ? "series" : kind.many;
      var one = isAnime && kind.types === "Series" ? "series" : kind.one;
      return {
        count: n.toLocaleString() + " " + (n === 1 ? one : many),
        square: !!kind.square,
        posters: (res.Items || []).map(function (item) {
          return client.getScaledImageUrl(item.Id, {
            type: "Primary",
            maxHeight: 260,
            tag: item.ImageTags && item.ImageTags.Primary,
          });
        }),
      };
    }).catch(function () {
      delete cache[id];
      return null;
    });
    return cache[id];
  }

  function decorate(card) {
    if (card.hasAttribute("data-jg-done")) return;
    card.setAttribute("data-jg-done", "");

    fetchLibrary(card).then(function (lib) {
      if (!lib) return;
      card.setAttribute("data-jg-count", lib.count);
      var title = card.querySelector(".cardText-first");
      if (title) title.setAttribute("data-jg-count", lib.count);

      var host = card.querySelector(".cardImageContainer");
      if (!host || host.querySelector(".jg-stack") || !lib.posters.length) return;
      var stack = document.createElement("div");
      stack.className = "jg-stack" + (lib.square ? " is-square" : "");
      stack.setAttribute("aria-hidden", "true");
      // Oldest of the three at the back, newest in front
      lib.posters.slice().reverse().forEach(function (src) {
        var p = document.createElement("span");
        p.style.backgroundImage = 'url("' + src + '")';
        stack.appendChild(p);
      });
      host.appendChild(stack);
    });
  }

  function scan() {
    if (!api()) return;
    var cards = document.querySelectorAll(
      '.homeSectionsContainer .card[data-type="CollectionFolder"]:not([data-jg-done])'
    );
    for (var i = 0; i < cards.length; i++) decorate(cards[i]);
  }

  // Media Bar Enhanced draws its slide bars as indicators only. Make each one go to its slide.
  function goToSlide(dot) {
    var mbe = window.mediaBarEnhanced;
    var index = parseInt(dot.getAttribute("data-index"), 10);
    if (!mbe || !mbe.SlideshowManager || isNaN(index)) return;
    if (index !== mbe.STATE.slideshow.currentSlideIndex) mbe.SlideshowManager.updateCurrentSlide(index);
  }

  document.addEventListener("click", function (e) {
    var dot = e.target.closest && e.target.closest("#slides-container .dot");
    if (!dot) return;
    e.preventDefault();
    e.stopPropagation();
    goToSlide(dot);
  }, true);

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var dot = e.target.closest && e.target.closest("#slides-container .dot");
    if (!dot) return;
    e.preventDefault();
    goToSlide(dot);
  }, true);

  function labelDots() {
    var dots = document.querySelectorAll("#slides-container .dot:not([role])");
    for (var i = 0; i < dots.length; i++) {
      var n = parseInt(dots[i].getAttribute("data-index"), 10) + 1;
      dots[i].setAttribute("role", "button");
      dots[i].setAttribute("tabindex", "0");
      dots[i].setAttribute("aria-label", "Show slide " + n);
    }
  }

  // ───────────── Title pages: season tabs and episode list ─────────────

  var itemCache = {};

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function getJSON(path, query) {
    var client = api();
    return client.getJSON(client.getUrl(path, query));
  }

  function currentItemId() {
    var m = /[?&]id=([0-9a-f]{32})/i.exec(location.hash);
    return m ? m[1] : null;
  }

  function getItem(id) {
    if (!itemCache[id]) {
      itemCache[id] = getJSON("Items/" + id, { userId: api().getCurrentUserId() }).catch(function () {
        delete itemCache[id];
        return null;
      });
    }
    return itemCache[id];
  }

  function minutes(ticks) {
    return ticks ? Math.round(ticks / 600000000) + " min" : "";
  }

  function detailsHref(id) {
    return "#/details?id=" + id + "&serverId=" + api().serverId();
  }

  function seasonTabs(seriesId, activeId, onPick) {
    var nav = el("div", "jg-season-tabs");
    nav.setAttribute("role", "tablist");
    getJSON("Shows/" + seriesId + "/Seasons", { userId: api().getCurrentUserId() }).then(function (res) {
      (res.Items || []).forEach(function (season) {
        var tab = el(onPick ? "button" : "a", "jg-season-tab", season.Name);
        tab.setAttribute("role", "tab");
        if (onPick) {
          tab.type = "button";
          tab.addEventListener("click", function () {
            nav.querySelectorAll(".jg-season-tab").forEach(function (t) {
              t.setAttribute("aria-selected", t === tab ? "true" : "false");
            });
            onPick(season.Id);
          });
        } else {
          tab.href = detailsHref(season.Id);
        }
        tab.setAttribute("aria-selected", season.Id === activeId ? "true" : "false");
        nav.appendChild(tab);
      });
      nav.hidden = (res.Items || []).length < 2 && !!onPick;
    });
    return nav;
  }

  function episodeRow(ep) {
    var client = api();
    var row = el("a", "jg-episode");
    row.href = detailsHref(ep.Id);

    var thumb = el("span", "jg-episode-thumb");
    var tag = ep.ImageTags && ep.ImageTags.Primary;
    if (tag) {
      thumb.style.backgroundImage =
        'url("' + client.getScaledImageUrl(ep.Id, { type: "Primary", maxWidth: 400, tag: tag }) + '")';
    }
    var data = ep.UserData || {};
    var pct = data.Played ? 100 : data.PlayedPercentage || 0;
    if (pct > 0) {
      var bar = el("span", "jg-episode-progress");
      var fill = el("span");
      fill.style.width = pct + "%";
      bar.appendChild(fill);
      thumb.appendChild(bar);
    }
    row.appendChild(thumb);

    var body = el("span", "jg-episode-body");
    var head = el("span", "jg-episode-title");
    head.appendChild(el("strong", null, (ep.IndexNumber != null ? ep.IndexNumber + ". " : "") + ep.Name));
    var meta = [minutes(ep.RunTimeTicks)];
    if (data.Played) meta.push("watched");
    head.appendChild(el("span", "jg-episode-meta", meta.filter(Boolean).join(", ")));
    body.appendChild(head);
    if (ep.Overview) body.appendChild(el("span", "jg-episode-overview", ep.Overview));
    row.appendChild(body);
    return row;
  }

  function fillEpisodes(list, seriesId, seasonId) {
    list.setAttribute("aria-busy", "true");
    getJSON("Shows/" + seriesId + "/Episodes", {
      userId: api().getCurrentUserId(),
      seasonId: seasonId,
      fields: "Overview,PrimaryImageAspectRatio",
      enableUserData: true,
    }).then(function (res) {
      list.textContent = "";
      (res.Items || []).forEach(function (ep) {
        list.appendChild(episodeRow(ep));
      });
      list.removeAttribute("aria-busy");
    });
  }

  // Series: tabs and episodes for the season you're up to
  function buildSeriesPanel(page, series) {
    var panel = el("section", "jg-episodes");
    panel.setAttribute("data-jg-for", series.Id);
    var list = el("div", "jg-episode-list");

    getJSON("Shows/NextUp", { userId: api().getCurrentUserId(), seriesId: series.Id, limit: 1 })
      .catch(function () { return {}; })
      .then(function (next) {
        var up = next.Items && next.Items[0];
        return getJSON("Shows/" + series.Id + "/Seasons", { userId: api().getCurrentUserId() }).then(function (s) {
          var seasons = s.Items || [];
          var start = (up && up.SeasonId) || (seasons[0] && seasons[0].Id);
          if (!start) return;
          panel.appendChild(seasonTabs(series.Id, start, function (id) { fillEpisodes(list, series.Id, id); }));
          panel.appendChild(list);
          fillEpisodes(list, series.Id, start);
        });
      });

    var host = page.querySelector(".detailPagePrimaryContainer");
    if (host) host.appendChild(panel);
  }

  // Season: Jellyfin already lists the episodes; add tabs for the other seasons above them
  function buildSeasonTabs(page, season) {
    var host = page.querySelector("#listChildrenCollapsible");
    if (!host || !season.SeriesId) return;
    var tabs = seasonTabs(season.SeriesId, season.Id, null);
    tabs.setAttribute("data-jg-for", season.Id);
    host.insertBefore(tabs, host.firstChild);
  }

  var lastDetail = null;

  function decorateDetail() {
    var page = document.querySelector(".itemDetailPage:not(.hide)");
    var id = currentItemId();
    if (!page || !id || !api()) return;
    var key = id + "|" + (page.querySelector(".detailRibbon .itemName") || {}).textContent;
    if (lastDetail === key && page.getAttribute("data-jg-item") === id) return;
    lastDetail = key;

    getItem(id).then(function (item) {
      if (!item || currentItemId() !== id) return;
      page.setAttribute("data-jg-item", id);
      page.setAttribute("data-jg-type", item.Type);
      page.querySelectorAll("[data-jg-for]").forEach(function (n) {
        if (n.getAttribute("data-jg-for") !== id) n.remove();
      });
      if (page.querySelector('[data-jg-for="' + id + '"]')) return;
      if (item.Type === "Series") buildSeriesPanel(page, item);
      if (item.Type === "Season") buildSeasonTabs(page, item);
    });
  }

  // ───────────── Phones: bottom tab bar ─────────────

  var GLYPHS = { movies: "movie", tvshows: "tv", boxsets: "collections_bookmark", music: "library_music",
    books: "menu_book", homevideos: "photo_library", livetv: "live_tv", playlists: "queue_music" };
  var tabbar = null;

  function tab(href, glyph, label, match) {
    var a = el("a", "jg-tab");
    a.href = href;
    a.setAttribute("data-jg-match", match);
    a.appendChild(el("span", "jg-tab-icon", glyph));
    a.appendChild(el("span", "jg-tab-label", label));
    return a;
  }

  function buildTabbar() {
    if (tabbar || !api() || !api().getCurrentUserId()) return;
    tabbar = el("nav", "jg-tabbar");
    tabbar.setAttribute("aria-label", "Libraries");
    document.body.appendChild(tabbar);
    getJSON("UserViews", { userId: api().getCurrentUserId() }).then(function (res) {
      tabbar.appendChild(tab("#/home", "home", "Home", "^#/home(?!\\?tab=1)"));
      (res.Items || []).slice(0, 3).forEach(function (v) {
        var type = v.CollectionType || "";
        var route = { movies: "movies", tvshows: "tv", music: "music", boxsets: "boxsets", livetv: "livetv" }[type] || "list";
        var glyph = /anime/i.test(v.Name) ? "animation" : GLYPHS[type] || "folder";
        tabbar.appendChild(tab("#/" + route + "?topParentId=" + v.Id + "&collectionType=" + type, glyph, v.Name, v.Id));
      });
      tabbar.appendChild(tab("#/search", "search", "Search", "^#/search"));
      markTab();
    });
  }

  function markTab() {
    if (!tabbar) return;
    var h = location.hash;
    document.documentElement.classList.toggle("jg-in-player", /^#\/video/.test(h));
    tabbar.querySelectorAll(".jg-tab").forEach(function (a) {
      var m = a.getAttribute("data-jg-match");
      var on = m.charAt(0) === "^" ? new RegExp(m).test(h) : h.indexOf(m) !== -1;
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  window.addEventListener("hashchange", markTab);

  // ───────────── Sign in: profile initials and a poster wall ─────────────

  var HUES = [330, 210, 145, 60, 280, 25, 185];
  var WALL_KEY = "jellyglass-wall";

  // While signed in, remember some poster ids so the sign-in page can show them
  function saveWall() {
    if (saveWall.done || !api() || !api().getCurrentUserId()) return;
    saveWall.done = true;
    getJSON("Items", { userId: api().getCurrentUserId(), IncludeItemTypes: "Movie,Series", Recursive: true,
      SortBy: "Random", ImageTypes: "Primary", Limit: 40, EnableTotalRecordCount: false }).then(function (res) {
      var ids = (res.Items || []).map(function (item) { return item.Id; });
      if (ids.length) localStorage.setItem(WALL_KEY, JSON.stringify(ids));
    }).catch(function () {});
  }

  function decorateLogin() {
    var page = document.querySelector("#loginPage:not(.hide)");
    if (!page) {
      saveWall();
      return;
    }
    saveWall.done = false;
    var title = page.querySelector(".visualLoginForm > h1");
    if (title && !page.querySelector(".jg-login-ask") && api()) {
      title.parentNode.insertBefore(el("p", "jg-login-kicker", "jellyfin"), title);
      title.parentNode.insertBefore(el("p", "jg-login-ask", "Who\u2019s watching?"), title.nextSibling);
      api().getPublicSystemInfo().then(function (info) {
        if (info.ServerName) title.textContent = info.ServerName;
      }).catch(function () {});
    }
    page.querySelectorAll("#divUsers .card").forEach(function (card, i) {
      var image = card.querySelector(".cardImage");
      var content = card.querySelector(".cardContent");
      if (!image || !content || image.hasAttribute("data-jg-initial") || !image.querySelector(".cardImageIcon")) return;
      var hue = HUES[i % HUES.length];
      image.setAttribute("data-jg-initial", (content.getAttribute("data-username") || "?").charAt(0).toUpperCase());
      image.style.setProperty("--jg-user-hue", hue);
    });
    if (!page.querySelector(".jg-wall") && api()) {
      var ids = [];
      try { ids = JSON.parse(localStorage.getItem(WALL_KEY)) || []; } catch (e) {}
      if (!ids.length) return;
      var wall = el("div", "jg-wall");
      wall.setAttribute("aria-hidden", "true");
      for (var n = 0; n < 48; n++) {
        var tile = el("span");
        tile.style.backgroundImage = "url('" + api().getImageUrl(ids[n % ids.length], { type: "Primary", maxHeight: 300, quality: 70 }) + "')";
        wall.appendChild(tile);
      }
      page.insertBefore(wall, page.firstChild);
    }
  }

  // ───────────── Dashboard: load the theme and add the design's captions ─────────────

  // Jellyfin's dashboard layout leaves out the server's Custom CSS, so link it here
  var SUBTITLES = {
    dashboardGeneralPage: "Server identity, paths and performance limits.",
    brandingPage: "What people see on the sign-in screen and across the web client.",
    userProfilesPage: "Accounts, permissions and library access.",
    mediaLibraryPage: "Media folders and how they are scanned and matched.",
    devicesPage: "Every app that has signed in to this server.",
    serverActivityPage: "Sign-ins, playback, plugin changes and server warnings.",
    liveTvStatusPage: "Tuners, guide data and recordings.",
    pluginsPage: "Plugins run inside your server. Installs, updates and removals take effect after a restart.",
    encodingSettingsPage: "Transcoding, resume points, streaming limits and trickplay.",
    playbackConfigurationPage: "Transcoding, resume points, streaming limits and trickplay.",
    streamingSettingsPage: "Transcoding, resume points, streaming limits and trickplay.",
    trickplayConfigurationPage: "Transcoding, resume points, streaming limits and trickplay.",
    networkingPage: "Ports, addresses and remote access.",
    apiKeysPage: "Keys that let other apps talk to this server.",
    backupsPage: "Snapshots of your server's settings and database.",
    logPage: "Server log files, newest first.",
    scheduledTasksPage: "Background jobs and when they run.",
  };

  var SECTIONS = {
    "Paths": "Program data, logs and web files are set when the server starts (--datadir, --logdir, --webdir) and can’t be changed here.",
    "Quick Connect": "Sign in on a TV by approving a code from a device that’s already signed in.",
    "Performance": "Lower these on low-power hardware.",
  };

  function decorateAdmin() {
    var admin = !!document.querySelector(".dashboard-appBar");
    document.documentElement.classList.toggle("jg-admin", admin);
    var link = document.getElementById("jg-admin-css");
    if (!admin) {
      if (link) link.remove();
      return;
    }
    if (!link && api()) {
      link = document.createElement("link");
      link.id = "jg-admin-css";
      link.rel = "stylesheet";
      link.href = api().getUrl("Branding/Css.css");
      document.head.appendChild(link);
    }

    var head = document.querySelector(".MuiDrawer-paper > .MuiList-root:first-child .MuiListItemIcon-root");
    var name = document.querySelector(".MuiDrawer-paper > .MuiList-root:first-child .MuiListItemText-primary");
    var initial = name && name.textContent.trim().charAt(0).toUpperCase();
    if (head && initial && head.getAttribute("data-jg-initial") !== initial) head.setAttribute("data-jg-initial", initial);

    var page = document.querySelector(".type-interior.page:not(.hide)");
    if (!page) return;
    var sub = SUBTITLES[page.id];
    var title = page.querySelector("h1, .sectionTitleContainer > .sectionTitle, .MuiTypography-h1");
    if (sub && title && !title.hasAttribute("data-jg-sub")) title.setAttribute("data-jg-sub", sub);
    page.querySelectorAll("form h2").forEach(function (h) {
      var desc = SECTIONS[h.textContent.trim()];
      if (desc && !h.hasAttribute("data-jg-desc")) h.setAttribute("data-jg-desc", desc);
    });
    page.querySelectorAll(".localUsers .card").forEach(function (card, i) {
      var image = card.querySelector(".cardImage");
      var nameText = card.querySelector(".cardText span");
      if (!image || !nameText || image.hasAttribute("data-jg-initial") || !image.querySelector(".cardImageIcon")) return;
      image.setAttribute("data-jg-initial", nameText.textContent.trim().charAt(0).toUpperCase());
      image.style.setProperty("--jg-user-hue", HUES[(i + 1) % HUES.length]);
    });
  }

  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      scan();
      labelDots();
      decorateDetail();
      buildTabbar();
      decorateLogin();
      decorateAdmin();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  scan();
})();
