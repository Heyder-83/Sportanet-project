-- MySQL dump 10.13  Distrib 9.1.0, for Win64 (x86_64)
--
-- Host: localhost    Database: sportanet_v1
-- ------------------------------------------------------
-- Server version	9.1.0

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `clubs`
--

DROP TABLE IF EXISTS `clubs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `clubs` (
  `club_id` int NOT NULL AUTO_INCREMENT,
  `club_name` varchar(100) NOT NULL,
  `address` varchar(255) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `event_organizers_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`club_id`),
  UNIQUE KEY `email` (`email`),
  KEY `fk_clubs_event_organizers` (`event_organizers_id`),
  CONSTRAINT `fk_clubs_event_organizers` FOREIGN KEY (`event_organizers_id`) REFERENCES `event_organizers` (`event_organizers_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_organizers`
--

DROP TABLE IF EXISTS `event_organizers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_organizers` (
  `event_organizers_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `about` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_organizers_id`),
  UNIQUE KEY `uq_organizer_user` (`user_id`),
  CONSTRAINT `fk_organizers_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_registrations`
--

DROP TABLE IF EXISTS `event_registrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_registrations` (
  `event_registration_id` int NOT NULL AUTO_INCREMENT,
  `sport_event_id` int NOT NULL,
  `user_id` int NOT NULL,
  `registration_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `registration_status` enum('Pending','Confirmed','Waitlisted','Canceled') NOT NULL DEFAULT 'Pending',
  `payment_status` enum('NotRequired','Pending','Paid','Refunded','Failed') NOT NULL DEFAULT 'NotRequired',
  `amount_due` decimal(10,2) NOT NULL DEFAULT '0.00',
  `currency` char(3) NOT NULL DEFAULT 'COP',
  `confirmed_at` datetime DEFAULT NULL,
  `canceled_at` datetime DEFAULT NULL,
  `canceled_by` enum('Participant','Organizer','Admin','System') DEFAULT NULL,
  `cancel_reason` varchar(500) DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_registration_id`),
  UNIQUE KEY `uq_registration_user_event` (`user_id`,`sport_event_id`),
  KEY `fk_event_registrations_sport_event` (`sport_event_id`),
  KEY `fk_event_registrations_users` (`user_id`),
  KEY `idx_registrations_event_status` (`sport_event_id`,`registration_status`),
  KEY `idx_registrations_user_status` (`user_id`,`registration_status`),
  CONSTRAINT `fk_event_registrations_sport_event` FOREIGN KEY (`sport_event_id`) REFERENCES `sport_events` (`sport_event_id`),
  CONSTRAINT `fk_event_registrations_users` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `chk_registrations_amount` CHECK ((`amount_due` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `legacy_event_organizers_v1`
--

DROP TABLE IF EXISTS `legacy_event_organizers_v1`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `legacy_event_organizers_v1` (
  `event_organizers_id` int NOT NULL DEFAULT '0',
  `first_name` varchar(50) DEFAULT NULL,
  `last_name` varchar(50) DEFAULT NULL,
  `birthdate` date DEFAULT NULL,
  `gender` enum('Male','Female','Undefied') DEFAULT NULL,
  `ID` int DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `legacy_sport_events_v1`
--

DROP TABLE IF EXISTS `legacy_sport_events_v1`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `legacy_sport_events_v1` (
  `sport_event_id` int NOT NULL DEFAULT '0',
  `club_id` int DEFAULT NULL,
  `event_organizers_id` int DEFAULT NULL,
  `title` varchar(100) NOT NULL,
  `event_description` text,
  `location` varchar(100) NOT NULL,
  `event_date` date NOT NULL,
  `max_capacity` int NOT NULL,
  `image` varchar(255) DEFAULT NULL,
  `publish_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `event_status` enum('Draft','Published','Completed','Canceled') DEFAULT 'Draft'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `legacy_user_profile_v1`
--

DROP TABLE IF EXISTS `legacy_user_profile_v1`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `legacy_user_profile_v1` (
  `up_id` int NOT NULL DEFAULT '0',
  `user_id` int DEFAULT NULL,
  `first_name` varchar(50) DEFAULT NULL,
  `last_name` varchar(50) DEFAULT NULL,
  `birthdate` date DEFAULT NULL,
  `gender` enum('Male','Female','Undefied') DEFAULT NULL,
  `ID` int DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `profile_picture` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `schema_migrations`
--

DROP TABLE IF EXISTS `schema_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `schema_migrations` (
  `version` varchar(50) NOT NULL,
  `description` varchar(255) NOT NULL,
  `applied_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sport_events`
--

DROP TABLE IF EXISTS `sport_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sport_events` (
  `sport_event_id` int NOT NULL AUTO_INCREMENT,
  `club_id` int DEFAULT NULL,
  `venue_id` int DEFAULT NULL,
  `event_organizers_id` int NOT NULL,
  `title` varchar(150) NOT NULL,
  `event_description` text,
  `sport` varchar(50) NOT NULL,
  `max_capacity` int NOT NULL,
  `cover_image` varchar(500) DEFAULT NULL,
  `event_status` enum('Draft','Published','Canceled','Completed') NOT NULL DEFAULT 'Draft',
  `start_at` datetime NOT NULL,
  `end_at` datetime NOT NULL,
  `timezone` varchar(64) NOT NULL DEFAULT 'America/Bogota',
  `modality` enum('InPerson','Virtual','Hybrid') NOT NULL DEFAULT 'InPerson',
  `online_url` varchar(500) DEFAULT NULL,
  `price` decimal(10,2) NOT NULL DEFAULT '0.00',
  `currency` char(3) NOT NULL DEFAULT 'COP',
  `registration_deadline` datetime DEFAULT NULL,
  `approval_mode` enum('Automatic','Manual') NOT NULL DEFAULT 'Automatic',
  `visibility` enum('Public','Private') NOT NULL DEFAULT 'Public',
  `share_token` char(32) DEFAULT NULL,
  `published_at` datetime DEFAULT NULL,
  `canceled_at` datetime DEFAULT NULL,
  `cancel_reason` varchar(500) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`sport_event_id`),
  UNIQUE KEY `uq_events_share_token` (`share_token`),
  KEY `fk_sport_events_clubs` (`club_id`),
  KEY `fk_sport_events_event_organizers` (`event_organizers_id`),
  KEY `idx_event_title` (`title`),
  KEY `idx_events_listing` (`event_status`,`visibility`,`start_at`),
  KEY `idx_events_sport` (`sport`),
  KEY `idx_events_venue` (`venue_id`),
  CONSTRAINT `fk_sport_events_clubs` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`club_id`),
  CONSTRAINT `fk_sport_events_event_organizers` FOREIGN KEY (`event_organizers_id`) REFERENCES `event_organizers` (`event_organizers_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_sport_events_venues` FOREIGN KEY (`venue_id`) REFERENCES `venues` (`venue_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `chk_events_capacity` CHECK ((`max_capacity` > 0)),
  CONSTRAINT `chk_events_dates` CHECK ((`end_at` > `start_at`)),
  CONSTRAINT `chk_events_deadline` CHECK (((`registration_deadline` is null) or (`registration_deadline` <= `end_at`))),
  CONSTRAINT `chk_events_price` CHECK ((`price` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_profile`
--

DROP TABLE IF EXISTS `user_profile`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_profile` (
  `up_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `first_name` varchar(50) DEFAULT NULL,
  `last_name` varchar(50) DEFAULT NULL,
  `birthdate` date DEFAULT NULL,
  `gender` enum('Male','Female','Other','Undisclosed') DEFAULT NULL,
  `document_id` varchar(30) DEFAULT NULL,
  `profile_picture` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`up_id`),
  UNIQUE KEY `uq_user_profile_user` (`user_id`),
  CONSTRAINT `fk_user_profile_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `full_name` varchar(100) NOT NULL,
  `email` varchar(100) NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `pwd` varchar(255) NOT NULL,
  `role` enum('Participant','Organizer','Admin') NOT NULL DEFAULT 'Participant',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `phone` (`phone`)
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `venues`
--

DROP TABLE IF EXISTS `venues`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `venues` (
  `venue_id` int NOT NULL AUTO_INCREMENT,
  `club_id` int DEFAULT NULL,
  `created_by_organizer_id` int DEFAULT NULL,
  `name` varchar(120) NOT NULL,
  `address` varchar(255) NOT NULL,
  `city` varchar(100) NOT NULL,
  `region` varchar(100) DEFAULT NULL,
  `country_code` char(2) NOT NULL DEFAULT 'CO',
  `latitude` decimal(9,6) DEFAULT NULL,
  `longitude` decimal(9,6) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`venue_id`),
  KEY `idx_venues_city` (`city`),
  KEY `idx_venues_club` (`club_id`),
  KEY `idx_venues_creator` (`created_by_organizer_id`),
  CONSTRAINT `fk_venues_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`club_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_venues_creator` FOREIGN KEY (`created_by_organizer_id`) REFERENCES `event_organizers` (`event_organizers_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `chk_venues_lat` CHECK (((`latitude` is null) or (`latitude` between -(90) and 90))),
  CONSTRAINT `chk_venues_lng` CHECK (((`longitude` is null) or (`longitude` between -(180) and 180)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-10-13 23:34:13
