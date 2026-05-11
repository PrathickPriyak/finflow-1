/**
 * Centralized formatting utilities for the application
 */

/**
 * Format a number as Indian Rupee currency
 * @param {number} amount - The amount to format
 * @returns {string} Formatted currency string (e.g., "₹1,00,000")
 */
export const formatCurrency = (amount, precise = false) => {
  if (amount === null || amount === undefined) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: precise ? 2 : 0,
    maximumFractionDigits: precise ? 2 : 0,
  }).format(amount);
};

/**
 * Format a date string to Indian locale format
 * @param {string} dateStr - ISO date string
 * @returns {string} Formatted date string (e.g., "06 Feb 2026, 02:30 pm")
 */
export const formatDate = (dateStr) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Format a date string to short format (date only)
 * @param {string} dateStr - ISO date string
 * @returns {string} Formatted date string (e.g., "06 Feb 2026")
 */
export const formatDateShort = (dateStr) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

/**
 * Format a date-time string for display
 * @param {string} dateStr - ISO date string
 * @returns {string} Formatted date-time string (e.g., "06 Feb 2026, 10:30 AM")
 */
export const formatDateTime = (dateStr) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

/**
 * Format a date for API calls (YYYY-MM-DD)
 * @param {Date} date - Date object
 * @returns {string} Formatted date string (e.g., "2026-02-14")
 */
export const formatDateForAPI = (date) => {
  if (!date) return '';
  return date.toISOString().split('T')[0];
};

/**
 * Calculate the age of a date in days
 * @param {string} dateStr - ISO date string
 * @returns {number} Number of days since the date
 */
export const getAgeDays = (dateStr) => {
  if (!dateStr) return 0;
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
};

/**
 * Format a phone number for display
 * @param {string} phone - Phone number string
 * @returns {string} Formatted phone number
 */
export const formatPhone = (phone) => {
  if (!phone) return '-';
  // Format as +91 XXXXX XXXXX
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 5)} ${cleaned.slice(5)}`;
  }
  return phone;
};


/**
 * Extract a readable error message from an API error response.
 * Handles Pydantic validation arrays and string detail messages.
 */
export const getApiError = (error, fallback = 'Something went wrong') => {
  const detail = error?.response?.data?.detail;
  if (!detail) return fallback;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map(e => (e.msg || e.message || '').replace('Value error, ', '')).filter(Boolean).join('. ') || fallback;
  }
  return fallback;
};
