import React, { useCallback, useEffect, useMemo, useState } from "react";

const milestones = [1, 5, 10];

function getStudentKey(feedback) {
  return feedback.studentId || feedback.email.toLowerCase();
}

function getMonthBuckets(feedback) {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
    return {
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: date.toLocaleString(undefined, { month: "short" }),
      count: 0,
    };
  });
  const buckets = new Map(months.map((month) => [month.key, month]));

  feedback.forEach((item) => {
    const date = new Date(item.submittedAt);
    if (Number.isNaN(date.getTime())) return;
    const bucket = buckets.get(`${date.getFullYear()}-${date.getMonth()}`);
    if (bucket) bucket.count += 1;
  });

  return months;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

async function loadFeedback() {
  const response = await fetch("/api/admin/feedback", { credentials: "same-origin" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message ?? "Could not load student feedback.");
  if (!Array.isArray(result.feedback)) throw new Error("The server returned invalid feedback data.");
  return result.feedback;
}

function AdminDashboard() {
  const [feedback, setFeedback] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      setFeedback(await loadFeedback());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const analytics = useMemo(() => {
    const students = new Map();
    feedback.forEach((item) => {
      const key = getStudentKey(item);
      const student = students.get(key) ?? {
        key,
        name: item.studentName,
        email: item.email,
        count: 0,
      };
      student.count += 1;
      students.set(key, student);
    });
    const average = feedback.length
      ? feedback.reduce((total, item) => total + item.rating, 0) / feedback.length
      : null;

    return {
      average,
      students: [...students.values()].sort((first, second) => second.count - first.count),
      lowRatings: feedback.filter((item) => item.rating <= 2).length,
      months: getMonthBuckets(feedback),
    };
  }, [feedback]);

  const maximumMonthlyCount = Math.max(1, ...analytics.months.map((month) => month.count));

  return (
    <section className="dashboard-content" aria-labelledby="admin-title">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow"><span /> ADMIN OVERVIEW</p>
          <h1 id="admin-title">Student feedback</h1>
          <p className="intro-copy">
            Review submissions, track participation, and celebrate student milestones.
          </p>
        </div>
        <button className="refresh-button" type="button" onClick={refresh} disabled={isLoading}>
          {isLoading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="admin-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={refresh}>Try again</button>
        </div>
      )}

      <div className="metric-grid" aria-label="Feedback analytics">
        <MetricCard label="Total feedback" value={feedback.length} />
        <MetricCard
          label="Average rating"
          value={analytics.average === null ? "—" : analytics.average.toFixed(1)}
          suffix={analytics.average === null ? "" : "/ 5"}
        />
        <MetricCard label="Students" value={analytics.students.length} />
        <MetricCard label="Needs follow-up" value={analytics.lowRatings} />
      </div>

      <section className="progress-panel" aria-labelledby="progress-title">
        <div className="admin-section-heading">
          <div>
            <p className="card-kicker">PARTICIPATION</p>
            <h2 id="progress-title">Feedback over time</h2>
          </div>
          <span className="admin-caption">Last 6 months</span>
        </div>
        <div className="progress-chart" role="img" aria-label="Monthly feedback submission counts for the last six months">
          {analytics.months.map((month) => (
            <div className="progress-month" key={month.key}>
              <span className="progress-count">{month.count}</span>
              <div className="progress-track">
                <span style={{ height: `${Math.max(4, (month.count / maximumMonthlyCount) * 100)}%` }} />
              </div>
              <span className="progress-label">{month.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="progress-panel" aria-labelledby="students-title">
        <div className="admin-section-heading">
          <div>
            <p className="card-kicker">MILESTONES</p>
            <h2 id="students-title">Student progress & achievements</h2>
          </div>
          <span className="admin-caption">Based on submitted feedback</span>
        </div>
        {analytics.students.length === 0 ? (
          <p className="dashboard-empty">Student progress will appear after the first feedback submission.</p>
        ) : (
          <ul className="student-progress-list">
            {analytics.students.map((student) => (
              <li className="student-progress-card" key={student.key}>
                <div className="student-progress-identity">
                  <strong>{student.name}</strong>
                  <span>{student.email}</span>
                </div>
                <div className="student-progress-count">
                  <strong>{student.count}</strong>
                  <span>{student.count === 1 ? "submission" : "submissions"}</span>
                </div>
                <div className="achievement-list" aria-label="Achievements">
                  {milestones.filter((milestone) => student.count >= milestone).length > 0
                    ? milestones
                      .filter((milestone) => student.count >= milestone)
                      .map((milestone) => (
                        <span className="achievement-badge" key={milestone}>
                          {milestone === 1 ? "First feedback" : `${milestone} submissions`}
                        </span>
                      ))
                    : <span className="achievement-pending">Next achievement at 1 submission</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="reviews-section" aria-labelledby="submissions-title">
        <div className="admin-section-heading reviews-toolbar">
          <div>
            <p className="card-kicker">ALL RESPONSES</p>
            <h2 id="submissions-title">Recent submissions</h2>
          </div>
          <span className="admin-caption">{feedback.length} total</span>
        </div>
        {isLoading && feedback.length === 0 ? (
          <p className="dashboard-empty" role="status">Loading feedback…</p>
        ) : feedback.length === 0 ? (
          <p className="dashboard-empty">No feedback has been submitted yet.</p>
        ) : (
          <div className="admin-feedback-list">
            {[...feedback].reverse().map((item, index) => (
              <article className="admin-feedback-card" key={`${getStudentKey(item)}-${item.submittedAt}-${index}`}>
                <div className="admin-feedback-top">
                  <div>
                    <h3>{item.studentName}</h3>
                    <p>{item.email}</p>
                  </div>
                  <span className={`rating-badge ${item.rating <= 2 ? "low" : "positive"}`}>
                    {item.rating} / 5
                  </span>
                </div>
                <div className="admin-feedback-meta">
                  <strong>{item.courseName}</strong>
                  <span>{formatDate(item.submittedAt)}</span>
                </div>
                <p className="review-message">{item.feedbackMessage}</p>
                <div className="review-foot">
                  <span className={item.rating <= 2 ? "feedback-label follow-up" : "feedback-label"}>
                    {item.feedbackStatus || (item.rating <= 2 ? "Needs follow-up" : "Positive")}
                  </span>
                  {item.studentId && <span>Account linked</span>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function MetricCard({ label, value, suffix = "" }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}<small>{suffix}</small></strong>
    </div>
  );
}

export default AdminDashboard;
