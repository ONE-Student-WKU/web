-- Database schema setup for wku_ai_chat

CREATE DATABASE IF NOT EXISTS wku_ai_chat;
USE wku_ai_chat;

-- Students table
CREATE TABLE IF NOT EXISTS students (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  password VARCHAR(255) NOT NULL,
  department VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notices table
CREATE TABLE IF NOT EXISTS notices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  author VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Courses table
CREATE TABLE IF NOT EXISTS courses (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  professor VARCHAR(100),
  credits INT NOT NULL
);

-- Registrations / Student-Course relation table
CREATE TABLE IF NOT EXISTS student_courses (
  student_id VARCHAR(50),
  course_id VARCHAR(50),
  PRIMARY KEY (student_id, course_id),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

-- Grades table
CREATE TABLE IF NOT EXISTS grades (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(50),
  course_id VARCHAR(50),
  grade VARCHAR(10) NOT NULL, -- e.g., A+, B0, Pass
  score DECIMAL(3, 2),
  semester VARCHAR(20), -- e.g., 2026-1
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);
