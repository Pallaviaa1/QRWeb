-- Run in master
CREATE LOGIN nodejs_user WITH PASSWORD = 'nodejs@123', CHECK_POLICY = OFF;

-- FSQC6_CONFIG
USE FSQC6_CONFIG;
CREATE USER nodejs_user FOR LOGIN nodejs_user;
ALTER ROLE db_owner ADD MEMBER nodejs_user;

-- FSQC6_TABLAS
USE FSQC6_TABLAS;
CREATE USER nodejs_user FOR LOGIN nodejs_user;
ALTER ROLE db_owner ADD MEMBER nodejs_user;


Run this in SSMS as admin:

USE FSQC6_TABLAS;
GO

--  Transfer ownership of schemas from nodejs_user to dbo
ALTER AUTHORIZATION ON SCHEMA::[db_owner] TO dbo;
ALTER AUTHORIZATION ON SCHEMA::[db_datareader] TO dbo;
GO

--  Now you can drop the user
DROP USER nodejs_user;
GO

-- Recreate the user mapped to the login
CREATE USER nodejs_user FOR LOGIN nodejs_user;
GO

--  Grant full access (or change to db_datareader if needed)
ALTER ROLE db_owner ADD MEMBER nodejs_user;
GO
