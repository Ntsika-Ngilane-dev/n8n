import React, { useEffect, useMemo, useState } from "react";

async function getApi(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? "Could not load the dashboard.");
  return body;
}

function StaffDashboard({ user }) {
  const [course, setCourse] = useState("");
  const [data, setData] = useState({ reviews: [], courses: [] });
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    setError("");
    const query = course ? `?course=${encodeURIComponent(course)}` : "";
    Promise.all([
      getApi(`/api/reviews${query}`),
      user.role === "admin" ? getApi("/api/admin/analytics") : Promise.resolve(null),
    ])
      .then(([reviews, summary]) => {
        setData(reviews);
        setAnalytics(summary);
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setIsLoading(false));
  }, [course, user.role]);

  const groupedReviews = useMemo(() => {
    if (course) return [[course, data.reviews]];
    return Object.entries(
      data.reviews.reduce((groups, review) => {
        (groups[review.courseName] ??= []).push(review);
        return groups;
      }, {}),
    );
  }, [course, data.reviews]);

  return (
    <section className="dashboard-content" aria-labelledby="dashboard-title">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow"><span /> LEARNING TEAM</p>
          <h1 id="dashboard-title">{user.role === "admin" ? "Lecturer overview." : "Course feedback."}</h1>
          <p className="intro-copy">
            {user.role === "admin"
              ? "Review student feedback across every course and track the overall learning experience."
              : "Read feedback for the courses assigned to you."}
          </p>
        </div>
        <div className="dashboard-badge">
          <span className={`role-dot ${user.role}`} />
          {user.role === "admin" ? "Lead lecturer · Admin access" : "Lecturer access"}
        </div>
      </div>

      {analytics && (
        <div className="metric-grid" aria-label="Feedback analytics">
          <Metric label="Total reviews" value={analytics.submissions ?? 0} />
          <Metric label="Average rating" value={analytics.averageRating ?? "—"} suffix="/ 5" />
          <Metric label="Needs follow-up" value={analytics.needsFollowUp ?? 0} />
          <Metric label="Courses" value={analytics.byCourse.length} />
        </div>
      )}

      {analytics?.byCourse.length > 0 && (
        <section className="course-summary" aria-labelledby="course-summary-title">
          <h2 id="course-summary-title">Course overview</h2>
          <div className="summary-grid">
            {analytics.byCourse.map((item) => (
              <button className="summary-card" key={item.courseName} onClick={() => setCourse(item.courseName)}>
                <span className="summary-course">{item.courseName}</span>
                <span className="summary-number">{item.submissions} <small>reviews</small></span>
                <span className="summary-meta">
                  Average {item.averageRating ?? "—"} / 5 · {item.needsFollowUp} need follow-up
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="reviews-section" aria-labelledby="reviews-title">
        <div className="reviews-toolbar">
          <div>
            <p className="card-kicker">STUDENT VOICES</p>
            <h2 id="reviews-title">Reviews</h2>
          </div>
          <label className="course-filter">
            <span>Group by course</span>
            <select value={course} onChange={(event) => setCourse(event.target.value)}>
              <option value="">All courses</option>
              {data.courses.map((courseName) => <option key={courseName} value={courseName}>{courseName}</option>)}
            </select>
          </label>
        </div>

        {error && <p className="form-status error" role="alert">{error}</p>}
        {isLoading ? (
          <p className="dashboard-empty">Loading feedback…</p>
        ) : data.reviews.length === 0 ? (
          <p className="dashboard-empty">
            {data.message ?? (course ? `There are no reviews for ${course} yet.` : "No student reviews have been submitted yet.")}
          </p>
        ) : (
          <div className="review-groups">
            {groupedReviews.map(([courseName, reviews]) => (
              <section className="review-group" key={courseName}>
                {!course && <h3>{courseName}<span>{reviews.length} {reviews.length === 1 ? "review" : "reviews"}</span></h3>}
                <div className="review-list">
                  {reviews.map((review) => (
                    <article className="review-card" key={review.id}>
                      <div className="review-topline">
                        <div>
                          <h4>{review.studentName}</h4>
                          <p>{review.courseName}</p>
                        </div>
                        <span className={`rating-badge ${review.rating <= 2 ? "low" : "positive"}`}>
                          <span aria-hidden="true">★</span> {review.rating} / 5
                        </span>
                      </div>
                      <p className="review-message">{review.feedbackMessage}</p>
                      <div className="review-foot">
                        <span className={`feedback-label ${review.rating <= 2 ? "follow-up" : ""}`}>
                          {review.feedbackStatus}
                        </span>
                        <time dateTime={review.submittedAt}>
                          {new Date(review.submittedAt).toLocaleDateString()}
                        </time>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function Metric({ label, value, suffix = "" }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}<small>{suffix}</small></strong>
    </div>
  );
}

export default StaffDashboard;
