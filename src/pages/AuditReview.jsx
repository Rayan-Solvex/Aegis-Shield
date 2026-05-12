import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useLocation } from 'react-router-dom';
import { PublicKey } from '@solana/web3.js';
import {
  Eye,
  Shield,
  Search,
  CheckCheck,
  AlertTriangle,
  Download,
  FileDown,
  Filter,
  Pencil,
  Lock,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Card, CardHeader, CardBody, CardFooter } from '../components/UI/Card.jsx';
import { Button } from '../components/UI/Button.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  extractMemoFromTransaction,
  fetchTransactionDetails,
  formatAmount,
  shortenAddress,
  generateStealthAddressForRecipient,
} from '../lib/umbra.js';
import { loadAuditReviewSession, saveAuditReviewSession } from '../lib/auditReviewSession.js';
import { AUDIT_PORTAL_DEV_BYPASS } from '../lib/auditPortalAccess.js';

const PAGE_SIZE = 10;

function toDateTimeLocalValue(value) {
  const date = value ? new Date(value) : new Date();
  const timezoneOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

function startOfScope(scopeDate) {
  return scopeDate ? `${scopeDate}T00:00` : toDateTimeLocalValue(new Date());
}

function endOfScope(scopeDate) {
  return scopeDate ? `${scopeDate}T23:59` : toDateTimeLocalValue(new Date());
}

function getAccountKeyString(accountKey) {
  if (typeof accountKey === 'string') {
    return accountKey;
  }

  if (accountKey?.pubkey?.toBase58) {
    return accountKey.pubkey.toBase58();
  }

  if (accountKey?.pubkey?.toString) {
    return accountKey.pubkey.toString();
  }

  return String(accountKey?.pubkey ?? accountKey ?? '');
}

function deriveLamportDelta(parsedTx, address) {
  const accountKeys = parsedTx?.transaction?.message?.accountKeys ?? [];
  const accountIndex = accountKeys.findIndex((accountKey) => getAccountKeyString(accountKey) === address);

  if (accountIndex === -1) {
    return null;
  }

  const preBalance = parsedTx?.meta?.preBalances?.[accountIndex];
  const postBalance = parsedTx?.meta?.postBalances?.[accountIndex];

  if (typeof preBalance !== 'number' || typeof postBalance !== 'number') {
    return null;
  }

  return postBalance - preBalance;
}

function formatLamports(lamports) {
  if (lamports === null || lamports === undefined) {
    return '—';
  }

  return `${lamports > 0 ? '+' : ''}${formatAmount(lamports / 1_000_000_000, 6)} SOL`;
}

function downloadTextFile(content, fileName, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

function printAuditReport(rows, metadata) {
  const reportWindow = window.open('', '_blank', 'noopener,noreferrer,width=1200,height=900');
  if (!reportWindow) {
    throw new Error('Pop-up blocked while preparing the PDF export');
  }

  const tableRows = rows.map((row) => `
    <tr>
      <td>${row.signature}</td>
      <td>${row.timestampLabel}</td>
      <td>${row.stealthAddress}</td>
      <td>${row.amountLabel}</td>
      <td>${row.verified ? 'Verified' : 'Review'}</td>
    </tr>
  `).join('');

  reportWindow.document.write(`
    <html>
      <head>
        <title>Aegis Audit Report</title>
        <style>
          body { font-family: Inter, Arial, sans-serif; padding: 32px; color: #111827; }
          h1 { margin-bottom: 8px; }
          p { margin: 4px 0; color: #4b5563; }
          table { width: 100%; border-collapse: collapse; margin-top: 24px; }
          th, td { border: 1px solid #d1d5db; padding: 10px 12px; font-size: 12px; text-align: left; }
          th { background: #f3f4f6; }
          td { word-break: break-all; }
        </style>
      </head>
      <body>
        <h1>Aegis Audit Report</h1>
        <p>Scope Date: ${metadata.scopeDate || 'Custom'}</p>
        <p>Stealth Address: ${metadata.stealthAddress || 'Pending'}</p>
        <p>Generated: ${new Date().toLocaleString()}</p>
        <table>
          <thead>
            <tr>
              <th>Transaction Signature</th>
              <th>Timestamp</th>
              <th>Stealth Address</th>
              <th>Amount</th>
              <th>Verify</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>
  `);

  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.print();
}

function ConnectPrompt() {
  return (
    <Card>
      <CardBody className="space-y-4 text-center">
        <div className="w-12 h-12 rounded-2xl mx-auto bg-aegis-teal/10 border border-aegis-teal/20 flex items-center justify-center">
          <Shield className="w-5 h-5 text-aegis-teal" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-aegis-text">Connect an Approved Auditor Wallet</h2>
          <p className="text-xs text-aegis-muted mt-1 max-w-md mx-auto">
            The review environment uses the connected wallet together with the carried viewing key scope.
          </p>
        </div>
        <div className="flex justify-center">
          <WalletMultiButton />
        </div>
      </CardBody>
    </Card>
  );
}

export function AuditReview() {
  const { connection } = useConnection();
  const { connected } = useWallet();
  const location = useLocation();
  const toast = useToast();

  const initialSession = useMemo(() => {
    const routeState = location.state && typeof location.state === 'object' ? location.state : null;
    return routeState?.resolvedViewingKey ? routeState : loadAuditReviewSession();
  }, [location.state]);

  const [activeViewingKey, setActiveViewingKey] = useState(initialSession?.resolvedViewingKey ?? '');
  const [allowManualEdit, setAllowManualEdit] = useState(!initialSession?.resolvedViewingKey);
  const [rangeStart, setRangeStart] = useState(startOfScope(initialSession?.scopeDate));
  const [rangeEnd, setRangeEnd] = useState(endOfScope(initialSession?.scopeDate));
  const [filterQuery, setFilterQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [stealthAddress, setStealthAddress] = useState(initialSession?.stealthAddress ?? '');
  const [results, setResults] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (!initialSession?.resolvedViewingKey) {
      return;
    }

    setActiveViewingKey(initialSession.resolvedViewingKey);
    setRangeStart(startOfScope(initialSession.scopeDate));
    setRangeEnd(endOfScope(initialSession.scopeDate));
    if (initialSession.stealthAddress) {
      setStealthAddress(initialSession.stealthAddress);
    }
  }, [initialSession]);

  const filteredResults = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    if (!query) {
      return results;
    }

    return results.filter((row) => {
      const searchTarget = [
        row.signature,
        row.stealthAddress,
        row.amountLabel,
        row.timestampLabel,
        row.memoPreview,
      ].join(' ').toLowerCase();

      return searchTarget.includes(query);
    });
  }, [filterQuery, results]);

  const totalPages = Math.max(1, Math.ceil(filteredResults.length / PAGE_SIZE));
  const paginatedResults = useMemo(() => {
    const pageStart = (currentPage - 1) * PAGE_SIZE;
    return filteredResults.slice(pageStart, pageStart + PAGE_SIZE);
  }, [currentPage, filteredResults]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterQuery, results]);

  const handleStartScan = useCallback(async () => {
    if (!activeViewingKey.trim()) {
      toast.error('Paste or carry a viewing key before starting the scan');
      return;
    }

    setScanning(true);
    setScanProgress('Deriving target stealth address...');

    try {
      const derivedStealthAddress = await generateStealthAddressForRecipient(connection, activeViewingKey.trim());
      const stealthPubkey = new PublicKey(derivedStealthAddress);
      const startBoundary = rangeStart ? Math.floor(new Date(rangeStart).getTime() / 1000) : null;
      const endBoundary = rangeEnd ? Math.floor(new Date(rangeEnd).getTime() / 1000) : null;

      setStealthAddress(derivedStealthAddress);
      setScanProgress('Loading transaction signatures for the resolved scope...');

      const signatures = await connection.getSignaturesForAddress(stealthPubkey, { limit: 100 });
      const scopedSignatures = signatures.filter((entry) => {
        if (!entry.blockTime) {
          return true;
        }

        if (startBoundary && entry.blockTime < startBoundary) {
          return false;
        }

        if (endBoundary && entry.blockTime > endBoundary) {
          return false;
        }

        return true;
      });

      const nextRows = [];
      for (let index = 0; index < scopedSignatures.length; index += 1) {
        const signatureInfo = scopedSignatures[index];
        setScanProgress(`Scanning transaction ${index + 1} of ${scopedSignatures.length}...`);
        const parsedTx = await fetchTransactionDetails(connection, signatureInfo.signature);
        const lamportDelta = deriveLamportDelta(parsedTx, derivedStealthAddress);
        const memo = extractMemoFromTransaction(parsedTx);
        const timestamp = signatureInfo.blockTime ?? parsedTx.blockTime ?? null;

        nextRows.push({
          signature: signatureInfo.signature,
          timestamp,
          timestampLabel: timestamp ? new Date(timestamp * 1000).toLocaleString() : 'Pending',
          stealthAddress: derivedStealthAddress,
          amountLamports: lamportDelta,
          amountLabel: formatLamports(lamportDelta),
          verified: true,
          memoPreview: memo ? JSON.stringify(memo) : '',
          explorerUrl: `https://explorer.solana.com/tx/${signatureInfo.signature}?cluster=devnet`,
        });
      }

      const sortedRows = nextRows.sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0));
      setResults(sortedRows);

      saveAuditReviewSession({
        ...(initialSession ?? {}),
        resolvedViewingKey: activeViewingKey.trim(),
        stealthAddress: derivedStealthAddress,
      });

      toast.success(`Audit scan completed with ${sortedRows.length} matching transactions`);
    } catch (error) {
      toast.error(error.message, { title: 'Audit Scan Failed' });
      setResults([]);
    } finally {
      setScanning(false);
      setScanProgress('');
    }
  }, [activeViewingKey, connection, initialSession, rangeEnd, rangeStart, toast]);

  const handleExportCsv = useCallback(() => {
    if (filteredResults.length === 0) {
      toast.error('Run a scan before exporting a report');
      return;
    }

    const csvLines = [
      ['Transaction Signature', 'Timestamp', 'Stealth Address', 'Amount', 'Verify'].join(','),
      ...filteredResults.map((row) => [
        row.signature,
        row.timestampLabel,
        row.stealthAddress,
        row.amountLabel,
        row.verified ? 'Verified' : 'Review',
      ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')),
    ];

    downloadTextFile(csvLines.join('\n'), `aegis-audit-report-${Date.now()}.csv`, 'text/csv;charset=utf-8');
    toast.success('CSV audit report exported');
  }, [filteredResults, toast]);

  const handleExportPdf = useCallback(() => {
    if (filteredResults.length === 0) {
      toast.error('Run a scan before exporting a report');
      return;
    }

    try {
      printAuditReport(filteredResults, {
        scopeDate: initialSession?.scopeDate,
        stealthAddress,
      });
      toast.success('PDF export opened in the print dialog');
    } catch (error) {
      toast.error(error.message, { title: 'PDF Export Failed' });
    }
  }, [filteredResults, initialSession?.scopeDate, stealthAddress, toast]);

  return (
    <div className="space-y-6">
      {AUDIT_PORTAL_DEV_BYPASS && !connected && (
        <Card>
          <CardBody className="space-y-3 text-center">
            <p className="text-sm font-semibold text-aegis-text">Development Bypass Enabled</p>
            <p className="text-xs text-aegis-muted">
              Audit Review remains visible without wallet authorization while the workflow is being tested.
            </p>
          </CardBody>
        </Card>
      )}

      {!AUDIT_PORTAL_DEV_BYPASS && !connected && <ConnectPrompt />}

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-aegis-teal/10 border border-aegis-teal/20 flex items-center justify-center">
          <Search className="w-5 h-5 text-aegis-teal" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-aegis-text">Audit Review</h1>
          <p className="text-xs text-aegis-muted">
            Conduct deep-scan and transaction verification for the resolved scope.
          </p>
        </div>
      </div>

      <Card>
        <CardBody className="space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-aegis-muted mb-1">Active Viewing Key</p>
              <p className="text-xs text-aegis-subtext">Resolved from Auditor Access and ready for review.</p>
            </div>
            <Button
              onClick={() => setAllowManualEdit((value) => !value)}
              variant="secondary"
              size="sm"
              icon={allowManualEdit ? Lock : Pencil}
            >
              {allowManualEdit ? 'Lock Key' : 'Edit Key'}
            </Button>
          </div>

          <div className="rounded-xl border border-aegis-border bg-aegis-bg px-4 py-3 shadow-sm">
            <input
              type="text"
              value={activeViewingKey}
              onChange={(event) => setActiveViewingKey(event.target.value)}
              readOnly={!allowManualEdit}
              placeholder="Resolved viewing key will appear here"
              className="w-full bg-transparent text-sm font-mono text-aegis-text outline-none placeholder:text-aegis-muted"
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-base font-semibold text-aegis-text">Scan Controls</h2>
              <p className="text-xs text-aegis-muted mt-0.5">Set the review timeframe and scan the resolved scope.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handleExportCsv} variant="secondary" size="sm" icon={Download} disabled={filteredResults.length === 0}>
                Export CSV
              </Button>
              <Button onClick={handleExportPdf} variant="secondary" size="sm" icon={FileDown} disabled={filteredResults.length === 0}>
                Export PDF
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardBody className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Start Time</label>
              <input
                type="datetime-local"
                value={rangeStart}
                onChange={(event) => setRangeStart(event.target.value)}
                className="input w-full mt-1"
              />
            </div>
            <div>
              <label className="form-label">End Time</label>
              <input
                type="datetime-local"
                value={rangeEnd}
                onChange={(event) => setRangeEnd(event.target.value)}
                className="input w-full mt-1"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={handleStartScan} loading={scanning} size="lg" icon={Search}>
              Start Audit Scan
            </Button>
            {scanProgress && (
              <p className="text-xs text-aegis-subtext">{scanProgress}</p>
            )}
            {stealthAddress && !scanProgress && (
              <div className="text-xs text-aegis-muted">
                Target stealth address: <span className="font-mono text-aegis-subtext">{shortenAddress(stealthAddress, 8)}</span>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-aegis-border/60 bg-aegis-card/40 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Filter className="w-3.5 h-3.5 text-aegis-cyan" />
              <span className="text-xs font-semibold text-aegis-subtext">Quick Filter</span>
            </div>
            <input
              type="text"
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              placeholder="Search by amount, address, signature, or memo"
              className="input w-full"
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-base font-semibold text-aegis-text">Audit Results</h2>
              <p className="text-xs text-aegis-muted mt-0.5">Scanned transactions for the currently resolved scope.</p>
            </div>
            <div className="text-xs text-aegis-muted">
              {filteredResults.length} result{filteredResults.length === 1 ? '' : 's'}
            </div>
          </div>
        </CardHeader>

        <CardBody className="space-y-4">
          {filteredResults.length === 0 ? (
            <div className="rounded-xl border border-aegis-border/60 bg-aegis-card/40 p-6 text-center">
              <div className="w-12 h-12 rounded-2xl mx-auto bg-aegis-teal/10 border border-aegis-teal/20 flex items-center justify-center mb-3">
                <Eye className="w-5 h-5 text-aegis-teal" />
              </div>
              <p className="text-sm font-semibold text-aegis-text">No scanned transactions yet</p>
              <p className="text-xs text-aegis-muted mt-1">Start the audit scan to load reviewable transactions for this viewing scope.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-aegis-border/60">
                <table className="min-w-full text-xs">
                  <thead className="bg-aegis-card/70">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-aegis-subtext">Transaction Signature</th>
                      <th className="px-4 py-3 text-left font-semibold text-aegis-subtext">Timestamp</th>
                      <th className="px-4 py-3 text-left font-semibold text-aegis-subtext">Stealth Address</th>
                      <th className="px-4 py-3 text-left font-semibold text-aegis-subtext">Amount</th>
                      <th className="px-4 py-3 text-left font-semibold text-aegis-subtext">Verify</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedResults.map((row) => (
                      <tr key={row.signature} className="border-t border-aegis-border/40 bg-aegis-surface/50">
                        <td className="px-4 py-3 font-mono text-aegis-text">
                          <a href={row.explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-aegis-cyan">
                            <span>{shortenAddress(row.signature, 8)}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </td>
                        <td className="px-4 py-3 text-aegis-subtext">{row.timestampLabel}</td>
                        <td className="px-4 py-3 font-mono text-aegis-subtext">{shortenAddress(row.stealthAddress, 8)}</td>
                        <td className="px-4 py-3 font-mono text-aegis-text">{row.amountLabel}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${row.verified ? 'bg-aegis-green/10 text-aegis-green border border-aegis-green/20' : 'bg-aegis-amber/10 text-aegis-amber border border-aegis-amber/20'}`}>
                            {row.verified ? <CheckCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                            {row.verified ? 'Verified' : 'Review'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-xs text-aegis-muted">
                  Page {currentPage} of {totalPages}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    variant="secondary"
                    size="sm"
                    icon={ChevronLeft}
                    disabled={currentPage === 1}
                  >
                    Prev
                  </Button>
                  <Button
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    variant="secondary"
                    size="sm"
                    icon={ChevronRight}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}