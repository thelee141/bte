import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ApiBetHistory,
  ApiBootstrap,
  ApiCompetition,
  ApiEvent,
  ApiReceipt,
  ApiSlip,
} from "../../src/app/contracts";
import type { RealtimeEvent, RealtimeSnapshot } from "../../src/realtime/types";
import { ApiClientError, api } from "./api";
import { displayPotentialReturn, formatNgn, parseStakeInput } from "./money";
import { connectRealtime, type StreamStatus } from "./realtime";

type FlashDirection = "up" | "down";
type NavPath = "/" | "/live" | "/my-bets" | "/results" | "/promotions" | "/games" | "/help";

interface Toast {
  readonly tone: "success" | "error" | "info";
  readonly message: string;
}

interface MatchStats {
  readonly homeCards: number;
  readonly awayCards: number;
  readonly homeCorners: number;
  readonly awayCorners: number;
}

function currentPath(): NavPath {
  const path = window.location.pathname;
  const allowed: NavPath[] = ["/", "/live", "/my-bets", "/results", "/promotions", "/games", "/help"];
  return allowed.includes(path as NavPath) ? (path as NavPath) : "/";
}

function navigate(path: NavPath): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function eventCompetition(
  competitions: readonly ApiCompetition[],
  event: ApiEvent,
): ApiCompetition | undefined {
  return competitions.find((competition) => competition.id === event.competitionId);
}

function formatKickoff(value: string): string {
  return new Intl.DateTimeFormat("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function selectionLabel(data: ApiBootstrap, selection: ApiSlip["selections"][number]) {
  const event = data.events.find((candidate) => candidate.id === selection.eventId);
  const market = event?.markets.find((candidate) => candidate.id === selection.marketId);
  const outcome = market?.outcomes.find((candidate) => candidate.id === selection.outcomeId);
  return {
    fixture: event ? `${event.home.name} v ${event.away.name}` : selection.eventId,
    market: market?.type ?? selection.marketId,
    outcome: outcome?.label ?? selection.outcomeId,
  };
}

function patchRealtime(data: ApiBootstrap, event: RealtimeEvent): ApiBootstrap {
  const events = data.events.map((match) => {
    if (event.kind === "EVENT_STATE" && match.id === event.payload.eventId) {
      return { ...match, status: event.payload.status };
    }
    if (event.kind === "CLOCK" && match.id === event.payload.eventId) {
      return {
        ...match,
        liveClock: event.payload.clock,
        period: event.payload.period,
      };
    }
    if (event.kind === "SCORE" && match.id === event.payload.eventId) {
      return {
        ...match,
        score: {
          home: event.payload.home,
          away: event.payload.away,
        },
      };
    }
    if (event.kind === "MARKET_STATE") {
      const markets = match.markets.map((market) =>
        market.id === event.payload.marketId
          ? { ...market, state: event.payload.state, version: event.payload.version }
          : market,
      );
      return markets === match.markets ? match : { ...match, markets };
    }
    if (event.kind === "PRICE") {
      let changed = false;
      const markets = match.markets.map((market) => ({
        ...market,
        outcomes: market.outcomes.map((outcome) => {
          if (outcome.id !== event.payload.outcomeId) return outcome;
          changed = true;
          return {
            ...outcome,
            price: {
              id: event.payload.priceId,
              outcomeId: event.payload.outcomeId,
              version: event.payload.version,
              decimalOdds: event.payload.decimalOdds,
            },
          };
        }),
      }));
      return changed ? { ...match, markets } : match;
    }
    return match;
  });

  return { ...data, events };
}

function applySnapshot(data: ApiBootstrap, snapshot: RealtimeSnapshot): ApiBootstrap {
  let next = data;
  for (const payload of snapshot.events) {
    next = patchRealtime(next, {
      sequence: snapshot.sequence,
      id: String(snapshot.sequence),
      kind: "EVENT_STATE",
      entityKey: `event:${payload.eventId}`,
      entityVersion: payload.version,
      publishedAt: "",
      payload,
    });
  }
  for (const payload of snapshot.clocks) {
    next = patchRealtime(next, {
      sequence: snapshot.sequence,
      id: String(snapshot.sequence),
      kind: "CLOCK",
      entityKey: `clock:${payload.eventId}`,
      entityVersion: payload.version,
      publishedAt: "",
      payload,
    });
  }
  for (const payload of snapshot.scores) {
    next = patchRealtime(next, {
      sequence: snapshot.sequence,
      id: String(snapshot.sequence),
      kind: "SCORE",
      entityKey: `score:${payload.eventId}:${payload.scope}`,
      entityVersion: payload.version,
      publishedAt: "",
      payload,
    });
  }
  for (const payload of snapshot.markets) {
    next = patchRealtime(next, {
      sequence: snapshot.sequence,
      id: String(snapshot.sequence),
      kind: "MARKET_STATE",
      entityKey: `market:${payload.marketId}`,
      entityVersion: payload.version,
      publishedAt: "",
      payload,
    });
  }
  for (const payload of snapshot.prices) {
    next = patchRealtime(next, {
      sequence: snapshot.sequence,
      id: String(snapshot.sequence),
      kind: "PRICE",
      entityKey: `price:${payload.outcomeId}`,
      entityVersion: payload.version,
      publishedAt: "",
      payload,
    });
  }
  return next;
}

function usePath(): NavPath {
  const [path, setPath] = useState<NavPath>(currentPath);
  useEffect(() => {
    const update = () => setPath(currentPath());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return path;
}

function Icon({ children }: { children: ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

function Header({
  path,
  balance,
  streamStatus,
  onTopUp,
}: {
  path: NavPath;
  balance: number;
  streamStatus: StreamStatus;
  onTopUp: () => void;
}) {
  const nav: Array<{ label: string; path: NavPath }> = [
    { label: "Sports", path: "/" },
    { label: "Live Betting", path: "/live" },
    { label: "Games", path: "/games" },
    { label: "Results", path: "/results" },
    { label: "Promotions", path: "/promotions" },
  ];

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" type="button" onClick={() => navigate("/")} aria-label="BTE Play home">
            <span className="brand-mark">B</span>
            <span>BTE <b>Play</b></span>
          </button>
          <nav className="primary-nav" aria-label="Primary">
            {nav.map((item) => (
              <button
                key={item.path}
                className={path === item.path ? "nav-item active" : "nav-item"}
                type="button"
                onClick={() => navigate(item.path)}
              >
                {item.label}
                {item.path === "/live" && <span className="live-dot" />}
              </button>
            ))}
          </nav>
          <div className="account-cluster">
            <div className="stream-pill" title="Realtime connection">
              <span className={streamStatus === "CONNECTED" ? "status-dot online" : "status-dot"} />
              <span>{streamStatus === "CONNECTED" ? "Live" : "Syncing"}</span>
            </div>
            <div className="balance-box">
              <span>Play balance</span>
              <strong>{formatNgn(balance)}</strong>
            </div>
            <button className="topup-button" type="button" onClick={onTopUp}>+ Demo funds</button>
          </div>
        </div>
      </header>
      <div className="play-banner">
        <strong>PLAY MONEY</strong>
        <span>No real-money deposits, withdrawals or wagering are enabled.</span>
      </div>
    </>
  );
}

function SportsStrip({
  data,
  selectedSport,
  onSelect,
}: {
  data: ApiBootstrap;
  selectedSport: string;
  onSelect: (sportId: string) => void;
}) {
  return (
    <div className="sports-strip-wrap">
      <div className="sports-strip" role="tablist" aria-label="Sports">
        <button
          className={selectedSport === "all" ? "sport-tab active" : "sport-tab"}
          type="button"
          onClick={() => onSelect("all")}
        >
          <Icon>⌂</Icon>
          Home
        </button>
        {data.sports.map((sport) => (
          <button
            key={sport.id}
            className={selectedSport === sport.id ? "sport-tab active" : "sport-tab"}
            type="button"
            onClick={() => onSelect(sport.id)}
          >
            <Icon>{sport.slug === "football" ? "⚽" : "◉"}</Icon>
            {sport.name}
          </button>
        ))}
        {["Tennis", "Table Tennis", "Ice Hockey", "eFootball", "More"].map((name) => (
          <button key={name} className="sport-tab muted" type="button" disabled>
            <Icon>•</Icon>{name}
          </button>
        ))}
      </div>
    </div>
  );
}

function LeagueRail({
  data,
  selectedSport,
  selectedCompetition,
  onSelectCompetition,
}: {
  data: ApiBootstrap;
  selectedSport: string;
  selectedCompetition: string | null;
  onSelectCompetition: (competition: string | null) => void;
}) {
  const competitions = data.competitions.filter(
    (competition) => selectedSport === "all" || competition.sportId === selectedSport,
  );
  const countByCompetition = new Map<string, number>();
  for (const event of data.events) {
    countByCompetition.set(event.competitionId, (countByCompetition.get(event.competitionId) ?? 0) + 1);
  }

  return (
    <aside className="league-rail" aria-label="Competition filters">
      <div className="rail-heading">
        <span>Popular</span>
        <button type="button" aria-label="Collapse leagues">−</button>
      </div>
      <button
        type="button"
        className={selectedCompetition === null ? "rail-link active" : "rail-link"}
        onClick={() => onSelectCompetition(null)}
      >
        <span>All matches</span>
        <b>{data.events.length}</b>
      </button>
      <button type="button" className="rail-link" onClick={() => navigate("/live")}>
        <span><span className="live-dot" /> Live now</span>
        <b>{data.events.filter((event) => event.status === "LIVE").length}</b>
      </button>
      <div className="rail-divider" />
      {data.categories
        .filter((category) => selectedSport === "all" || category.sportId === selectedSport)
        .map((category) => {
          const children = competitions.filter((competition) => competition.categoryId === category.id);
          return (
            <section key={category.id} className="rail-group">
              <div className="rail-group-title">
                <span>{category.region ?? "•"}</span>
                <strong>{category.name}</strong>
              </div>
              {children.map((competition) => (
                <button
                  key={competition.id}
                  type="button"
                  className={selectedCompetition === competition.id ? "rail-link nested active" : "rail-link nested"}
                  onClick={() => onSelectCompetition(competition.id)}
                >
                  <span>{competition.name}</span>
                  <b>{countByCompetition.get(competition.id) ?? 0}</b>
                </button>
              ))}
            </section>
          );
        })}
    </aside>
  );
}

function OddsButton({
  label,
  odds,
  disabled,
  selected,
  flash,
  onClick,
}: {
  label: string;
  odds: string | null;
  disabled: boolean;
  selected: boolean;
  flash?: FlashDirection;
  onClick: () => void;
}) {
  return (
    <button
      className={[
        "odds-button",
        selected ? "selected" : "",
        disabled ? "suspended" : "",
        flash ? `flash-${flash}` : "",
      ].filter(Boolean).join(" ")}
      type="button"
      disabled={disabled || odds === null}
      onClick={onClick}
      aria-pressed={selected}
    >
      <span className="odds-label">{label}</span>
      <strong>{disabled ? "—" : odds ?? "—"}</strong>
      {disabled && <span className="lock-mark">⌁</span>}
    </button>
  );
}

function EventRow({
  event,
  selectedOutcomes,
  flashes,
  stats,
  busy,
  onToggle,
}: {
  event: ApiEvent;
  selectedOutcomes: Set<string>;
  flashes: ReadonlyMap<string, FlashDirection>;
  stats?: MatchStats;
  busy: boolean;
  onToggle: (eventId: string, marketId: string, outcomeId: string) => void;
}) {
  const main = event.markets.find((market) => market.type === "1X2") ?? event.markets[0];
  const overUnder = event.markets.find((market) => market.type === "OU");
  const isLive = event.status === "LIVE" || event.status === "PAUSED";

  return (
    <article className={isLive ? "event-row live" : "event-row"}>
      <div className="event-meta">
        {isLive ? (
          <>
            <span className="live-label">LIVE</span>
            <strong>{event.liveClock ?? "—"}</strong>
            <small>{event.period ?? ""}</small>
          </>
        ) : (
          <>
            <strong>{formatKickoff(event.startsAt)}</strong>
            <small>{formatDate(event.startsAt)}</small>
          </>
        )}
      </div>

      <div className="fixture">
        <div className="fixture-team">
          <span>{event.home.name}</span>
          {isLive && <b>{event.score?.home ?? 0}</b>}
        </div>
        <div className="fixture-team">
          <span>{event.away.name}</span>
          {isLive && <b>{event.score?.away ?? 0}</b>}
        </div>
        {isLive && stats && (
          <div className="live-stats">
            <span>Cards {stats.homeCards}–{stats.awayCards}</span>
            <span>Corners {stats.homeCorners}–{stats.awayCorners}</span>
          </div>
        )}
      </div>

      <div className="market-grid main-market" aria-label="Main market">
        {main?.outcomes.slice(0, 3).map((outcome) => (
          <OddsButton
            key={outcome.id}
            label={outcome.label}
            odds={outcome.price?.decimalOdds ?? null}
            disabled={busy || main.state !== "OPEN" || outcome.state !== "OPEN"}
            selected={selectedOutcomes.has(outcome.id)}
            flash={flashes.get(outcome.id)}
            onClick={() => onToggle(event.id, main.id, outcome.id)}
          />
        ))}
      </div>

      <div className="market-grid ou-market" aria-label="Over under market">
        {overUnder ? (
          overUnder.outcomes.slice(0, 2).map((outcome) => (
            <OddsButton
              key={outcome.id}
              label={`${outcome.label === "Over" ? "O" : "U"} ${overUnder.line ?? ""}`}
              odds={outcome.price?.decimalOdds ?? null}
              disabled={busy || overUnder.state !== "OPEN" || outcome.state !== "OPEN"}
              selected={selectedOutcomes.has(outcome.id)}
              flash={flashes.get(outcome.id)}
              onClick={() => onToggle(event.id, overUnder.id, outcome.id)}
            />
          ))
        ) : (
          <span className="market-empty">—</span>
        )}
      </div>

      <button className="more-markets" type="button" title="More markets planned">
        +{Math.max(5, event.markets.length * 12)}
      </button>
    </article>
  );
}

function EventFeed({
  data,
  events,
  selectedOutcomes,
  flashes,
  stats,
  busy,
  path,
  onToggle,
}: {
  data: ApiBootstrap;
  events: readonly ApiEvent[];
  selectedOutcomes: Set<string>;
  flashes: ReadonlyMap<string, FlashDirection>;
  stats: ReadonlyMap<string, MatchStats>;
  busy: boolean;
  path: NavPath;
  onToggle: (eventId: string, marketId: string, outcomeId: string) => void;
}) {
  const grouped = new Map<string, ApiEvent[]>();
  for (const event of events) {
    const current = grouped.get(event.competitionId) ?? [];
    current.push(event);
    grouped.set(event.competitionId, current);
  }

  return (
    <main className="event-feed">
      <div className="feed-toolbar">
        <div>
          <h1>{path === "/live" ? "Live Betting" : "Sports"}</h1>
          <span>{events.length} events</span>
        </div>
        <div className="feed-tabs">
          <button className={path === "/" ? "active" : ""} type="button" onClick={() => navigate("/")}>Highlights</button>
          <button className={path === "/live" ? "active" : ""} type="button" onClick={() => navigate("/live")}>
            Live
          </button>
          <button type="button" disabled>Upcoming</button>
        </div>
      </div>

      {events.length === 0 && (
        <div className="empty-panel">
          <div className="empty-symbol">⌁</div>
          <h2>No matches in this view</h2>
          <p>Try another sport or remove the competition filter.</p>
        </div>
      )}

      {[...grouped.entries()].map(([competitionId, matches]) => {
        const competition = eventCompetition(data.competitions, matches[0]);
        return (
          <section key={competitionId} className="league-block">
            <div className="league-header">
              <div>
                <span className="league-pin">◆</span>
                <strong>{competition?.name ?? competitionId}</strong>
                <small>{matches.length} events</small>
              </div>
              <div className="column-hints">
                <span>1</span><span>X</span><span>2</span>
                <span>O/U</span>
              </div>
            </div>
            {matches.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                selectedOutcomes={selectedOutcomes}
                flashes={flashes}
                stats={stats.get(event.id)}
                busy={busy}
                onToggle={onToggle}
              />
            ))}
          </section>
        );
      })}
    </main>
  );
}

function BetslipPanel({
  data,
  busy,
  stakeText,
  bookingCode,
  onStakeText,
  onPersistStake,
  onPlace,
  onBook,
  onLoadCode,
  onAcceptPrices,
  onClear,
}: {
  data: ApiBootstrap;
  busy: boolean;
  stakeText: string;
  bookingCode: string;
  onStakeText: (value: string) => void;
  onPersistStake: () => void;
  onPlace: () => void;
  onBook: () => void;
  onLoadCode: (code: string) => void;
  onAcceptPrices: () => void;
  onClear: () => void;
}) {
  const [codeInput, setCodeInput] = useState("");
  const selectedOdds = data.slip.selections.map(
    (selection) => selection.currentDecimalOdds ?? selection.decimalOdds,
  );
  const parsedStake = parseStakeInput(stakeText) ?? data.slip.stakeMinor ?? 0;
  const potential = displayPotentialReturn(parsedStake, selectedOdds);
  const hasChanged = data.slip.selections.some((selection) => selection.freshness === "PRICE_CHANGED");
  const blockedByTrading = data.slip.selections.some(
    (selection) => selection.freshness === "SUSPENDED" || selection.freshness === "UNAVAILABLE",
  );

  return (
    <aside className="betslip-panel">
      <div className="betslip-tabs">
        <button className="active" type="button">
          Betslip <span>{data.slip.selections.length}</span>
        </button>
        <button type="button" onClick={() => navigate("/my-bets")}>Open Bets</button>
      </div>

      <div className="mode-line">
        <div className="mode-toggle" aria-label="Bet mode">
          <button type="button" disabled>SIM</button>
          <button className="active" type="button">REAL</button>
        </div>
        <span className="play-only">Play money</span>
      </div>

      <div className="selection-list">
        {data.slip.selections.length === 0 && (
          <div className="slip-empty">
            <div>＋</div>
            <strong>Your betslip is empty</strong>
            <span>Tap an odd to add a selection.</span>
          </div>
        )}

        {data.slip.selections.map((selection) => {
          const label = selectionLabel(data, selection);
          const changed = selection.freshness === "PRICE_CHANGED";
          return (
            <div key={selection.id} className="slip-selection">
              <div className="slip-selection-top">
                <span className={`freshness ${selection.freshness.toLowerCase()}`}>
                  {selection.freshness === "CURRENT" ? "Current" : selection.freshness.replace("_", " ")}
                </span>
                <strong>{selection.currentDecimalOdds ?? selection.decimalOdds}</strong>
              </div>
              <b>{label.fixture}</b>
              <span>{label.market} · {label.outcome}</span>
              {changed && (
                <small>Booked {selection.decimalOdds} → now {selection.currentDecimalOdds}</small>
              )}
            </div>
          );
        })}
      </div>

      {data.slip.selections.length > 0 && (
        <>
          <div className="stake-row">
            <label htmlFor="stake">Total Stake / NGN</label>
            <div className="stake-input-wrap">
              <span>₦</span>
              <input
                id="stake"
                inputMode="decimal"
                value={stakeText}
                onChange={(event) => onStakeText(event.target.value)}
                onBlur={onPersistStake}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="return-row">
            <span>Potential return <small>estimate</small></span>
            <strong>{formatNgn(potential)}</strong>
          </div>

          {hasChanged && (
            <button className="price-change-button" type="button" disabled={busy} onClick={onAcceptPrices}>
              Accept new prices
            </button>
          )}

          <button
            className="place-button"
            type="button"
            disabled={busy || data.slip.blocked || blockedByTrading || parsedStake <= 0}
            onClick={onPlace}
          >
            {busy ? "Working…" : data.slip.blocked ? "Review selections" : "Place Bet"}
          </button>

          <div className="slip-actions">
            <button type="button" disabled={busy} onClick={onBook}>Book Bet</button>
            <button type="button" disabled={busy} onClick={onClear}>Clear</button>
          </div>
        </>
      )}

      {bookingCode && (
        <div className="booking-result">
          <span>Booking code</span>
          <strong>{bookingCode}</strong>
          <small>Prices are revalidated when loaded.</small>
        </div>
      )}

      <form
        className="code-loader"
        onSubmit={(event) => {
          event.preventDefault();
          if (codeInput.trim()) onLoadCode(codeInput.trim());
        }}
      >
        <label htmlFor="booking-code">Load Booking Code</label>
        <div>
          <input
            id="booking-code"
            value={codeInput}
            onChange={(event) => setCodeInput(event.target.value.toUpperCase())}
            placeholder="Enter code"
            maxLength={16}
          />
          <button type="submit" disabled={busy || codeInput.trim().length === 0}>Load</button>
        </div>
      </form>
    </aside>
  );
}

function ReceiptModal({ receipt, onClose }: { receipt: ApiReceipt; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="receipt-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="receipt-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="receipt-success">✓</div>
        <h2 id="receipt-title">Bet accepted</h2>
        <p>Your play-money bet was committed successfully.</p>
        <dl>
          <div><dt>Bet reference</dt><dd>{receipt.betRef}</dd></div>
          <div><dt>Transaction reference</dt><dd className="mono">{receipt.txnRef}</dd></div>
          <div><dt>Stake</dt><dd>{formatNgn(receipt.stakeMinor)}</dd></div>
          <div><dt>Total odds</dt><dd>{receipt.totalOdds}</dd></div>
          <div><dt>Potential return</dt><dd>{formatNgn(receipt.potentialWinMinor)}</dd></div>
          <div><dt>Selections</dt><dd>{receipt.legCount}</dd></div>
        </dl>
        <button className="place-button" type="button" onClick={onClose}>Done</button>
      </section>
    </div>
  );
}

function BetsList({
  title,
  bets,
  demoControls,
  onSettle,
}: {
  title: string;
  bets: readonly ApiBetHistory[];
  demoControls?: boolean;
  onSettle?: (betId: string, outcome: "WON" | "LOST" | "VOID") => void;
}) {
  return (
    <section className="bets-list-section">
      <div className="page-section-heading">
        <h2>{title}</h2>
        <span>{bets.length}</span>
      </div>
      {bets.length === 0 ? (
        <div className="empty-panel compact">
          <h3>Nothing here yet</h3>
          <p>Placed bets will appear here.</p>
        </div>
      ) : (
        <div className="bet-cards">
          {bets.map((bet) => (
            <article key={bet.betId} className="bet-card">
              <div className="bet-card-head">
                <strong>{bet.betRef}</strong>
                <span className={`bet-status ${bet.settlement?.outcome?.toLowerCase() ?? "open"}`}>
                  {bet.settlement?.outcome ?? "OPEN"}
                </span>
              </div>
              <div className="bet-metrics">
                <div><span>Stake</span><b>{formatNgn(bet.stakeMinor)}</b></div>
                <div><span>Odds</span><b>{bet.totalOdds}</b></div>
                <div><span>Potential</span><b>{formatNgn(bet.potentialWinMinor)}</b></div>
                {bet.settlement && <div><span>Credit</span><b>{formatNgn(bet.settlement.creditMinor)}</b></div>}
              </div>
              <small>{new Date(bet.createdAt).toLocaleString("en-NG")}</small>
              {demoControls && onSettle && (
                <div className="demo-settle">
                  <span>Demo result:</span>
                  <button type="button" onClick={() => onSettle(bet.betId, "WON")}>Win</button>
                  <button type="button" onClick={() => onSettle(bet.betId, "LOST")}>Lose</button>
                  <button type="button" onClick={() => onSettle(bet.betId, "VOID")}>Void</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function MyBetsPage({
  data,
  onSettle,
}: {
  data: ApiBootstrap;
  onSettle: (betId: string, outcome: "WON" | "LOST" | "VOID") => void;
}) {
  return (
    <div className="standalone-page">
      <div className="page-hero">
        <div>
          <span className="eyebrow">PLAY MONEY HISTORY</span>
          <h1>My Bets</h1>
          <p>Open bets and settled outcomes from the real transaction core.</p>
        </div>
      </div>
      <BetsList title="Open Bets" bets={data.openBets} demoControls onSettle={onSettle} />
      <BetsList title="Settled" bets={data.settledBets} />
    </div>
  );
}

function PromotionsPage() {
  const cards = [
    { badge: "FEATURE", title: "Weekend Lift", text: "A future original odds-boost mechanic. Rules are not active in this build." },
    { badge: "COMING LATER", title: "Flex Play", text: "Promo-engine placeholder. No bonus wallet or promotional settlement rules are enabled." },
    { badge: "PLAY MONEY", title: "Demo Balance", text: "Use the demo-funds control to explore the full betting flow without real money." },
  ];
  return (
    <div className="standalone-page">
      <div className="page-hero">
        <div><span className="eyebrow">BTE PLAY</span><h1>Promotions</h1><p>Original promotion surfaces, clearly separated from unimplemented mechanics.</p></div>
      </div>
      <div className="promo-grid">
        {cards.map((card) => (
          <article key={card.title} className="promo-card">
            <span>{card.badge}</span><h2>{card.title}</h2><p>{card.text}</p><button type="button" disabled>Not active</button>
          </article>
        ))}
      </div>
    </div>
  );
}

function GamesPage() {
  return (
    <div className="standalone-page">
      <div className="page-hero">
        <div><span className="eyebrow">PROVIDER-BACKED ONLY</span><h1>Games</h1><p>The lobby is intentionally not faked. Certified provider integration belongs to a later slice.</p></div>
      </div>
      <div className="game-placeholder-grid">
        {Array.from({ length: 8 }, (_, index) => <div key={index} className="game-placeholder"><span>Provider game</span></div>)}
      </div>
    </div>
  );
}

function HelpPage() {
  const topics = ["Sports betting", "Live betting", "Booking codes", "Bet settlement", "Play-money wallet", "Responsible gaming architecture"];
  return (
    <div className="standalone-page">
      <div className="page-hero"><div><span className="eyebrow">SUPPORT</span><h1>Help Centre</h1><p>Development documentation for the currently implemented customer flows.</p></div></div>
      <div className="help-grid">{topics.map((topic) => <button key={topic} type="button">{topic}<span>›</span></button>)}</div>
    </div>
  );
}

function BottomNav({
  path,
  slipCount,
  onOpenSlip,
}: {
  path: NavPath;
  slipCount: number;
  onOpenSlip: () => void;
}) {
  return (
    <nav className="bottom-nav" aria-label="Mobile navigation">
      <button className={path === "/" ? "active" : ""} type="button" onClick={() => navigate("/")}><Icon>⌂</Icon><span>Sports</span></button>
      <button className={path === "/live" ? "active" : ""} type="button" onClick={() => navigate("/live")}><Icon>●</Icon><span>Live</span></button>
      <button className="slip-nav" type="button" onClick={onOpenSlip}><Icon>▤</Icon><span>Betslip</span>{slipCount > 0 && <b>{slipCount}</b>}</button>
      <button className={path === "/my-bets" ? "active" : ""} type="button" onClick={() => navigate("/my-bets")}><Icon>✓</Icon><span>My Bets</span></button>
      <button className={path === "/help" ? "active" : ""} type="button" onClick={() => navigate("/help")}><Icon>☰</Icon><span>Menu</span></button>
    </nav>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div><strong>BTE Play</strong><p>Original play-money sportsbook development build.</p></div>
        <div><b>Product</b><button type="button" onClick={() => navigate("/")}>Sports</button><button type="button" onClick={() => navigate("/live")}>Live</button></div>
        <div><b>Support</b><button type="button" onClick={() => navigate("/help")}>Help Centre</button><span>System status: Development</span></div>
        <div><b>Safety</b><span>18+ architecture planned</span><span>Real-money mode disabled</span></div>
      </div>
      <div className="legal-strip">Development environment · PLAY MONEY ONLY · No deposits or withdrawals · © 2026 BTE Play</div>
    </footer>
  );
}

export function App() {
  const path = usePath();
  const [data, setData] = useState<ApiBootstrap | null>(null);
  const [selectedSport, setSelectedSport] = useState("all");
  const [selectedCompetition, setSelectedCompetition] = useState<string | null>(null);
  const [mobileSlipOpen, setMobileSlipOpen] = useState(false);
  const [receipt, setReceipt] = useState<ApiReceipt | null>(null);
  const [bookingCode, setBookingCode] = useState("");
  const [stakeText, setStakeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("CONNECTING");
  const [toast, setToast] = useState<Toast | null>(null);
  const [stats, setStats] = useState<Map<string, MatchStats>>(new Map());
  const [flashes, setFlashes] = useState<Map<string, FlashDirection>>(new Map());
  const flashTimers = useRef(new Map<string, number>());

  const showToast = useCallback((next: Toast) => {
    setToast(next);
    window.setTimeout(() => setToast((current) => current === next ? null : current), 3200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await api.bootstrap();
      setData(next);
    } catch (error) {
      showToast({
        tone: "error",
        message: error instanceof Error ? error.message : "Could not load sportsbook",
      });
    }
  }, [showToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!data) return;
    const minor = data.slip.stakeMinor;
    setStakeText(minor === null ? "" : (minor / 100).toFixed(2));
  }, [data?.slip.id, data?.slip.stakeMinor]);

  useEffect(() => {
    const disconnect = connectRealtime({
      onStatus: setStreamStatus,
      onSnapshot: (snapshot) => {
        setData((current) => current ? applySnapshot(current, snapshot) : current);
        const nextStats = new Map<string, MatchStats>();
        for (const item of snapshot.stats) {
          nextStats.set(item.eventId, {
            homeCards: item.homeCards,
            awayCards: item.awayCards,
            homeCorners: item.homeCorners,
            awayCorners: item.awayCorners,
          });
        }
        setStats(nextStats);
      },
      onEvent: (event) => {
        if (event.kind === "PRICE") {
          setData((current) => {
            if (!current) return current;
            let previous: string | null = null;
            for (const match of current.events) {
              for (const market of match.markets) {
                const outcome = market.outcomes.find((candidate) => candidate.id === event.payload.outcomeId);
                if (outcome?.price) previous = outcome.price.decimalOdds;
              }
            }
            if (previous !== null && previous !== event.payload.decimalOdds) {
              const direction: FlashDirection =
                Number.parseFloat(event.payload.decimalOdds) > Number.parseFloat(previous) ? "up" : "down";
              setFlashes((currentFlashes) => new Map(currentFlashes).set(event.payload.outcomeId, direction));
              const oldTimer = flashTimers.current.get(event.payload.outcomeId);
              if (oldTimer) window.clearTimeout(oldTimer);
              flashTimers.current.set(
                event.payload.outcomeId,
                window.setTimeout(() => {
                  setFlashes((currentFlashes) => {
                    const next = new Map(currentFlashes);
                    next.delete(event.payload.outcomeId);
                    return next;
                  });
                }, 900),
              );
            }
            return patchRealtime(current, event);
          });
          return;
        }

        if (event.kind === "STATS") {
          setStats((current) => new Map(current).set(event.payload.eventId, {
            homeCards: event.payload.homeCards,
            awayCards: event.payload.awayCards,
            homeCorners: event.payload.homeCorners,
            awayCorners: event.payload.awayCorners,
          }));
          return;
        }

        setData((current) => current ? patchRealtime(current, event) : current);
      },
    });

    return () => {
      disconnect();
      for (const timer of flashTimers.current.values()) window.clearTimeout(timer);
      flashTimers.current.clear();
    };
  }, []);

  const run = useCallback(async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : "Request failed";
      showToast({ tone: "error", message });
    } finally {
      setBusy(false);
    }
  }, [busy, showToast]);

  const selectedOutcomes = useMemo(
    () => new Set(data?.slip.selections.map((selection) => selection.outcomeId) ?? []),
    [data?.slip.selections],
  );

  const filteredEvents = useMemo(() => {
    if (!data) return [];
    return data.events.filter((event) => {
      if (path === "/live" && event.status !== "LIVE" && event.status !== "PAUSED") return false;
      if (selectedSport !== "all" && event.sportId !== selectedSport) return false;
      if (selectedCompetition && event.competitionId !== selectedCompetition) return false;
      return true;
    });
  }, [data, path, selectedSport, selectedCompetition]);

  const persistStake = useCallback(async () => {
    const minor = parseStakeInput(stakeText);
    if (!minor || !data) return;
    try {
      const result = await api.setStake(minor);
      setData({ ...data, slip: result.slip });
    } catch (error) {
      showToast({ tone: "error", message: error instanceof Error ? error.message : "Could not save stake" });
    }
  }, [data, stakeText, showToast]);

  if (!data) {
    return (
      <div className="app-loading">
        <div className="brand-mark large">B</div>
        <strong>Loading BTE Play</strong>
        <span>Connecting to the fixture sportsbook…</span>
      </div>
    );
  }

  const toggle = (eventId: string, marketId: string, outcomeId: string) => {
    void run(async () => {
      const result = await api.toggleSelection({ eventId, marketId, outcomeId });
      setData((current) => current ? { ...current, slip: result.slip } : current);
      if (window.innerWidth < 768) setMobileSlipOpen(true);
    });
  };

  const place = () => {
    void run(async () => {
      const minor = parseStakeInput(stakeText);
      if (!minor) throw new ApiClientError("INVALID_STAKE", "Enter a valid stake first.");
      const stakeResult = await api.setStake(minor);
      setData((current) => current ? { ...current, slip: stakeResult.slip } : current);
      const result = await api.placeBet(crypto.randomUUID());
      setReceipt(result.receipt);
      setBookingCode("");
      setMobileSlipOpen(false);
      await refresh();
    });
  };

  const settleDemo = (betId: string, outcome: "WON" | "LOST" | "VOID") => {
    void run(async () => {
      await api.settleDemo(betId, outcome);
      showToast({ tone: "success", message: `Demo bet settled as ${outcome.toLowerCase()}.` });
      await refresh();
    });
  };

  return (
    <div className="app-shell">
      <Header
        path={path}
        balance={data.demo.balanceMinor}
        streamStatus={streamStatus}
        onTopUp={() => void run(async () => {
          await api.topUp();
          showToast({ tone: "success", message: "Added ₦1,000.00 play money." });
          await refresh();
        })}
      />

      <SportsStrip
        data={data}
        selectedSport={selectedSport}
        onSelect={(sport) => {
          setSelectedSport(sport);
          setSelectedCompetition(null);
          if (path !== "/" && path !== "/live") navigate("/");
        }}
      />

      {path === "/" || path === "/live" ? (
        <div className="sports-layout">
          <LeagueRail
            data={data}
            selectedSport={selectedSport}
            selectedCompetition={selectedCompetition}
            onSelectCompetition={setSelectedCompetition}
          />
          <EventFeed
            data={data}
            events={filteredEvents}
            selectedOutcomes={selectedOutcomes}
            flashes={flashes}
            stats={stats}
            busy={busy}
            path={path}
            onToggle={toggle}
          />
          <div className="desktop-slip">
            <BetslipPanel
              data={data}
              busy={busy}
              stakeText={stakeText}
              bookingCode={bookingCode}
              onStakeText={setStakeText}
              onPersistStake={() => void persistStake()}
              onPlace={place}
              onBook={() => void run(async () => {
                const minor = parseStakeInput(stakeText);
                if (minor) await api.setStake(minor);
                const result = await api.bookSlip();
                setBookingCode(result.booking.code);
                showToast({ tone: "success", message: `Booked as ${result.booking.code}` });
              })}
              onLoadCode={(code) => void run(async () => {
                const result = await api.loadBooking(code);
                setData((current) => current ? { ...current, slip: result.slip } : current);
                setBookingCode("");
                showToast({ tone: "info", message: "Booking loaded at current prices." });
              })}
              onAcceptPrices={() => void run(async () => {
                const result = await api.acceptPrices();
                setData((current) => current ? { ...current, slip: result.slip } : current);
              })}
              onClear={() => void run(async () => {
                const result = await api.clearSlip();
                setData((current) => current ? { ...current, slip: result.slip } : current);
              })}
            />
          </div>
        </div>
      ) : path === "/my-bets" ? (
        <MyBetsPage data={data} onSettle={settleDemo} />
      ) : path === "/results" ? (
        <div className="standalone-page">
          <div className="page-hero"><div><span className="eyebrow">RESULTS</span><h1>Settled Bets</h1><p>Canonical settlement history from the play-money engine.</p></div></div>
          <BetsList title="Recent settlements" bets={data.settledBets} />
        </div>
      ) : path === "/promotions" ? (
        <PromotionsPage />
      ) : path === "/games" ? (
        <GamesPage />
      ) : (
        <HelpPage />
      )}

      <Footer />

      <BottomNav
        path={path}
        slipCount={data.slip.selections.length}
        onOpenSlip={() => setMobileSlipOpen(true)}
      />

      {mobileSlipOpen && (
        <div className="mobile-slip-backdrop" onMouseDown={() => setMobileSlipOpen(false)}>
          <div className="mobile-slip-sheet" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <button className="sheet-close" type="button" onClick={() => setMobileSlipOpen(false)} aria-label="Close betslip">×</button>
            <BetslipPanel
              data={data}
              busy={busy}
              stakeText={stakeText}
              bookingCode={bookingCode}
              onStakeText={setStakeText}
              onPersistStake={() => void persistStake()}
              onPlace={place}
              onBook={() => void run(async () => {
                const minor = parseStakeInput(stakeText);
                if (minor) await api.setStake(minor);
                const result = await api.bookSlip();
                setBookingCode(result.booking.code);
              })}
              onLoadCode={(code) => void run(async () => {
                const result = await api.loadBooking(code);
                setData((current) => current ? { ...current, slip: result.slip } : current);
                setBookingCode("");
              })}
              onAcceptPrices={() => void run(async () => {
                const result = await api.acceptPrices();
                setData((current) => current ? { ...current, slip: result.slip } : current);
              })}
              onClear={() => void run(async () => {
                const result = await api.clearSlip();
                setData((current) => current ? { ...current, slip: result.slip } : current);
              })}
            />
          </div>
        </div>
      )}

      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}

      {toast && <div className={`toast ${toast.tone}`} role="status">{toast.message}</div>}
    </div>
  );
}
