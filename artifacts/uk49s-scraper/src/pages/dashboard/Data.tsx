import { useState, useEffect } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle,
  Database,
  Download,
  Filter,
  RefreshCw,
  Table,
  XCircle,
} from 'lucide-react';

interface DataSummary {
  success: boolean;
  lunchtime: {
    totalDraws: number;
    earliestDate: string | null;
    latestDate: string | null;
    yearCounts: { year: number; count: number }[];
    missingDates: string[];
    duplicateCount: number;
    validationErrors: number;
  };
  teatime: {
    totalDraws: number;
    earliestDate: string | null;
    latestDate: string | null;
    yearCounts: { year: number; count: number }[];
    missingDates: string[];
    duplicateCount: number;
    validationErrors: number;
  };
}

interface ScrapeRun {
  id: number;
  drawType: string;
  year: number;
  recordsAccepted: number;
  duplicatesRemoved: number;
  recordsRejected: number;
  success: boolean;
  completedAt: string | null;
}

export default function DataPage() {
  const [data, setData] = useState<DataSummary | null>(null);
  const [scrapeRuns, setScrapeRuns] = useState<ScrapeRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'lunchtime' | 'teatime'>('lunchtime');

  useEffect(() => {
    async function fetchData() {
      try {
        const [summaryRes, runsRes] = await Promise.all([
          fetch('/api/data/summary'),
          fetch('/api/data/scrape-runs?limit=50'),
        ]);
        
        if (summaryRes.ok) {
          setData(await summaryRes.json());
        }
        if (runsRes.ok) {
          const runs = await runsRes.json();
          setScrapeRuns(runs.scrapeRuns || []);
        }
      } catch (e) {
        console.error('Failed to load data:', e);
      } finally {
        setLoading(false);
      }
    }
    
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="dashboard-loading">
        <RefreshCw className="spin" size={32} />
        <p>Loading data...</p>
      </div>
    );
  }

  const summary = data?.[activeTab];
  const otherSummary = data?.[activeTab === 'lunchtime' ? 'teatime' : 'lunchtime'];

  return (
    <div className="dashboard-data">
      <div className="page-intro">
        <div>
          <div className="overline">
            <span className="overline-line" />
            DATA MANAGEMENT
          </div>
          <h1>Historical <em>Data</em></h1>
          <p>
            View historical UK49s draw data, data quality metrics, and scrape history.
          </p>
        </div>
      </div>

      {/* Draw Type Tabs */}
      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'lunchtime' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('lunchtime')}
        >
          <CalendarDays size={16} />
          Lunchtime
        </button>
        <button 
          className={`tab ${activeTab === 'teatime' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('teatime')}
        >
          <CalendarDays size={16} />
          Teatime
        </button>
      </div>

      {/* Stats Summary */}
      <section className="section">
        <h2 className="section-title">
          <Database size={20} />
          Data Summary - {activeTab === 'lunchtime' ? 'Lunchtime' : 'Teatime'}
        </h2>
        
        <div className="stat-grid stat-grid-4">
          <div className="stat-tile">
            <div className="stat-accent stat-accent-yellow" />
            <p className="eyebrow">Total Draws</p>
            <p className="stat-value">{summary?.totalDraws || 0}</p>
            <p className="stat-hint">Across all years</p>
          </div>
          <div className="stat-tile">
            <div className="stat-accent stat-accent-blue" />
            <p className="eyebrow">Earliest Date</p>
            <p className="stat-value">{summary?.earliestDate || 'N/A'}</p>
          </div>
          <div className="stat-tile">
            <div className="stat-accent stat-accent-coral" />
            <p className="eyebrow">Latest Date</p>
            <p className="stat-value">{summary?.latestDate || 'N/A'}</p>
          </div>
          <div className="stat-tile">
            <div className="stat-accent stat-accent-green" />
            <p className="eyebrow">Years of Data</p>
            <p className="stat-value">{summary?.yearCounts?.length || 0}</p>
          </div>
        </div>
      </section>

      {/* Year Breakdown */}
      <section className="section">
        <h2 className="section-title">
          <Table size={20} />
          Year-by-Year Breakdown
        </h2>
        
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>Draw Count</th>
                <th>Expected*</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {summary?.yearCounts?.map(({ year, count }) => {
                // Expected draws: ~365 for lunchtime, ~365 for teatime
                const expected = 365;
                const diff = count - expected;
                const status = diff >= -20 && diff <= 20 ? 'good' : diff >= -50 ? 'warning' : 'error';
                
                return (
                  <tr key={year}>
                    <td className="year-cell">{year}</td>
                    <td>{count}</td>
                    <td>{expected} ±20</td>
                    <td>
                      <span className={`status-indicator status-${status}`}>
                        {status === 'good' && <CheckCircle size={14} />}
                        {status === 'warning' && <AlertCircle size={14} />}
                        {status === 'error' && <XCircle size={14} />}
                        {status === 'good' ? 'Complete' : status === 'warning' ? 'Minor Gap' : 'Incomplete'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="table-note">
            * Expected draws assumes daily draws (excluding special events). 
            Minor variations are normal.
          </p>
        </div>
      </section>

      {/* Data Quality */}
      <section className="section">
        <h2 className="section-title">
          <Filter size={20} />
          Data Quality
        </h2>
        
        <div className="stat-grid stat-grid-3">
          <div className="stat-tile">
            <div className="stat-accent stat-accent-green" />
            <p className="eyebrow">Duplicates Removed</p>
            <p className="stat-value">{summary?.duplicateCount || 0}</p>
          </div>
          <div className="stat-tile">
            <div className="stat-accent stat-accent-coral" />
            <p className="eyebrow">Validation Errors</p>
            <p className="stat-value">{summary?.validationErrors || 0}</p>
          </div>
          <div className="stat-tile">
            <div className="stat-accent stat-accent-yellow" />
            <p className="eyebrow">Missing Date Ranges</p>
            <p className="stat-value">{summary?.missingDates?.length || 0}</p>
          </div>
        </div>
        
        {summary?.missingDates && summary.missingDates.length > 0 && (
          <div className="panel alert-panel">
            <h4>Potentially Missing Dates</h4>
            <ul className="missing-list">
              {summary.missingDates.slice(0, 5).map((range, i) => (
                <li key={i}>{range}</li>
              ))}
              {summary.missingDates.length > 5 && (
                <li className="more">...and {summary.missingDates.length - 5} more</li>
              )}
            </ul>
          </div>
        )}
      </section>

      {/* Scrape History */}
      <section className="section">
        <h2 className="section-title">
          <RefreshCw size={20} />
          Recent Scrape History
        </h2>
        
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Year</th>
                <th>Imported</th>
                <th>Duplicates</th>
                <th>Rejected</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {scrapeRuns.filter(r => r.drawType === activeTab).slice(0, 10).map((run) => (
                <tr key={run.id}>
                  <td>{run.completedAt ? new Date(run.completedAt).toLocaleDateString() : 'N/A'}</td>
                  <td className="type-cell">{run.drawType}</td>
                  <td>{run.year}</td>
                  <td className="success-cell">{run.recordsAccepted}</td>
                  <td>{run.duplicatesRemoved}</td>
                  <td className={run.recordsRejected > 0 ? 'error-cell' : ''}>{run.recordsRejected}</td>
                  <td>
                    <span className={`status-badge ${run.success ? 'status-success' : 'status-error'}`}>
                      {run.success ? 'Success' : 'Failed'}
                    </span>
                  </td>
                </tr>
              ))}
              {scrapeRuns.filter(r => r.drawType === activeTab).length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-cell">No scrape history available</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Export */}
      <section className="section">
        <h2 className="section-title">
          <Download size={20} />
          Export Data
        </h2>
        
        <div className="export-buttons">
          <a href="/api/data/export?drawType=lunchtime&format=json" className="btn btn-secondary">
            <Download size={16} />
            Lunchtime JSON
          </a>
          <a href="/api/data/export?drawType=teatime&format=json" className="btn btn-secondary">
            <Download size={16} />
            Teatime JSON
          </a>
          <a href="/api/data/export?drawType=lunchtime&format=csv" className="btn btn-secondary">
            <Download size={16} />
            Lunchtime CSV
          </a>
          <a href="/api/data/export?drawType=teatime&format=csv" className="btn btn-secondary">
            <Download size={16} />
            Teatime CSV
          </a>
        </div>
      </section>
    </div>
  );
}
