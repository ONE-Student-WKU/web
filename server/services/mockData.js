const db = require('../db');

/**
 * server/services/mockData.js
 * Business logic tier functions to retrieve academic databases (notices, courses, grades).
 */

async function getNotices() {
  // TODO: Query mock notices database.
  return [];
}

async function getCoursesByStudentId(studentId) {
  // TODO: Query mock courses database filtering by studentId.
  return [];
}

async function getGradesByStudentId(studentId) {
  // TODO: Query mock grades database filtering by studentId.
  return [];
}

module.exports = {
  getNotices,
  getCoursesByStudentId,
  getGradesByStudentId,
};
