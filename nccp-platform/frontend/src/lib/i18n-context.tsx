import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

export type LanguageTag = 'en' | 'hi'

const hindiDictionary: Record<string, string> = {
  // Navigation & Core Modules
  'Home': 'होम',
  'Dashboard': 'डैशबोर्ड',
  'My Dashboard': 'मेरा डैशबोर्ड',
  'Institutions': 'संस्थान',
  'Institution Management': 'संस्थान प्रबंधन',
  'Programmes': 'कार्यक्रम',
  'Programme Management': 'कार्यक्रम प्रबंधन',
  'Trainees': 'प्रशिक्षु / युवा',
  'Trainee Management': 'प्रशिक्षु प्रबंधन',
  'Trainers': 'प्रशिक्षक',
  'Trainer Management': 'प्रशिक्षक प्रबंधन',
  'Batches': 'बैच',
  'Batch Management': 'बैच प्रबंधन',
  'My Batches': 'मेरे बैच',
  'My Timetable': 'मेरी समय सारणी',
  'Courses': 'पाठ्यक्रम',
  'Trainee Performance': 'प्रशिक्षु प्रदर्शन',
  'AI Teaching Assistant': 'एआई शिक्षण सहायक',
  'Trainer Analytics': 'प्रशिक्षक विश्लेषण',
  'Training Operations': 'प्रशिक्षण संचालन',
  'LMS': 'ई-लर्निंग (एलएमएस)',
  'LMS Management': 'एलएमएस प्रबंधन',
  'Attendance': 'उपस्थिति',
  'Attendance Management': 'उपस्थिति प्रबंधन',
  'Certification': 'प्रमाणन',
  'Certificates': 'प्रमाण पत्र',
  'Employment': 'रोजगार और नौकरियां',
  'Employment Ecosystem': 'रोजगार पारिस्थितिकी तंत्र',
  'Post a Job': 'नौकरी पोस्ट करें',
  'Manage Jobs': 'नौकरियां प्रबंधित करें',
  'Applications': 'आवेदन',
  'Candidate Matches': 'उम्मीदवार मिलान',
  'Interviews': 'साक्षात्कार',
  'Selection & Placements': 'चयन एवं प्लेसमेंट',
  'AI Recruitment Assistant': 'एआई भर्ती सहायक',
  'Messages': 'संदेश',
  'Company Profile': 'कंपनी प्रोफ़ाइल',
  'Help & Support': 'सहायता और समर्थन',
  'Skill Wallet': 'कौशल वॉलेट',
  'Jobs & Placements': 'नौकरियां और प्लेसमेंट',
  'My Applications': 'मेरे आवेदन',
  'AI Career Assistant': 'एआई करियर सहायक',
  'My Learning': 'मेरा अध्ययन',
  'Course Player': 'पाठ्यक्रम प्लेयर',
  'Analytics & Reports': 'विश्लेषण और रिपोर्ट',
  'Analytics': 'विश्लेषण',
  'Reports': 'रिपोर्ट',
  'AI Monitoring': 'एआई निगरानी',
  'System Administration': 'प्रणाली प्रशासन',
  'Course Content': 'पाठ्यक्रम सामग्री',
  'Assessments': 'मूल्यांकन',
  'Timetable': 'समय सारणी',
  'Hostel': 'छात्रावास',
  'Logistics': 'लॉजिस्टिक्स एवं आपूर्ति',
  'Announcements': 'घोषणाएं',
  'Settings': 'सेटिंग्स',
  'Institution Settings': 'संस्थान सेटिंग्स',
  'Course Catalogue': 'पाठ्यक्रम सूची',
  'Opportunities': 'अवसर',
  'Resources': 'संसाधन',
  'About': 'के बारे में',
  'Profile': 'प्रोफ़ाइल',

  // Actions & Buttons
  'Export': 'निर्यात करें',
  'Export data': 'डेटा निर्यात करें',
  'Add': 'जोड़ें',
  'Add new': 'नया जोड़ें',
  'Create New': 'नया बनाएं',
  'Save': 'सहेजें',
  'Save changes': 'बदलाव सहेजें',
  'Cancel': 'रद्द करें',
  'Delete': 'हटाएं',
  'Edit': 'संपादित करें',
  'View': 'देखें',
  'Search': 'खोजें',
  'Filter': 'फ़िल्टर',
  'Approve': 'स्वीकृत करें',
  'Reject': 'अस्वीकृत करें',
  'Close': 'बंद करें',
  'Submit': 'जमा करें',
  'Logout': 'लॉग आउट',
  'Log out': 'लॉग आउट',
  'Profile settings': 'प्रोफ़ाइल सेटिंग्स',
  'Notifications': 'सूचनाएं',
  'Mark all as read': 'सभी को पढ़ा हुआ चिह्नित करें',
  'Mark as read': 'पढ़ा हुआ चिह्नित करें',
  'Manage batches': 'बैच प्रबंधित करें',
  'View all': 'सभी देखें',
  'Review all': 'सभी की समीक्षा करें',
  'Back to Home': 'होम पेज पर वापस जाएं',
  'Sign In': 'साइन इन करें',
  'Sign In to Portal': 'पोर्टल में साइन इन करें',
  'Get Started': 'शुरू करें',
  'Watch Video': 'वीडियो देखें',
  'Check in': 'उपस्थिति दर्ज करें',
  'Check In': 'उपस्थिति दर्ज करें',
  'Recommend': 'अनुशंसा करें',
  'Download': 'डाउनलोड करें',
  'Print': 'प्रिंट करें',
  'Share': 'साझा करें',
  'Apply': 'आवेदन करें',
  'Apply Now': 'अभी आवेदन करें',
  'Shortlist': 'शॉर्टलिस्ट करें',
  'Publish job': 'नौकरी प्रकाशित करें',
  'Save draft': 'ड्राफ्ट सहेजें',
  'Schedule interview': 'साक्षात्कार निर्धारित करें',

  // QR Code & Biometrics
  'Camera / Biometric Attendance': 'कैमरा / बायोमेट्रिक उपस्थिति',
  'Face Recognition': 'चेहरा पहचान',
  'Biometric Attendance': 'बायोमेट्रिक उपस्थिति',
  'Camera Attendance': 'कैमरा उपस्थिति',
  'Capture & Verify': 'फोटो खींचें और सत्यापित करें',
  'Capture Photo': 'फोटो खींचें',
  'Position your face clearly within the frame.': 'कृपया अपना चेहरा कैमरे के फ्रेम के अंदर रखें।',
  'Face Verified': 'चेहरा सफलतापूर्वक सत्यापित',
  'Verification Failed': 'सत्यापन विफल',
  'Camera Permission Required': 'कैमरा अनुमति आवश्यक है',
  'Retake': 'पुनः प्रयास करें',
  'Mark Attendance': 'उपस्थिति दर्ज करें',
  'Camera Active': 'कैमरा सक्रिय है',
  'Verifying...': 'सत्यापन किया जा रहा है...',
  'Generate Session QR Code': 'सत्र क्यूआर कोड जनरेट करें',
  'Scan Session QR Code': 'सत्र क्यूआर कोड स्कैन करें',
  'Live Session QR Code': 'लाइव सत्र क्यूआर कोड',
  'Scan with your mobile camera or trainee portal to mark attendance instantly.': 'तत्काल उपस्थिति दर्ज करने के लिए अपने मोबाइल कैमरे या शिक्षार्थी पोर्टल से स्कैन करें।',
  'QR Attendance Entry': 'क्यूआर उपस्थिति प्रविष्टि',
  'Active Session Token': 'सक्रिय सत्र टोकन',
  'Copy Token': 'टोकन कॉपी करें',
  'Token Copied!': 'टोकन कॉपी हो गया!',

  // Metrics & Headers
  'Total records': 'कुल रिकॉर्ड',
  'Active / approved': 'सक्रिय / स्वीकृत',
  'Pending action': 'लंबित कार्रवाई',
  'Total Trainees': 'कुल प्रशिक्षु',
  'Active Batches': 'सक्रिय बैच',
  'Active Programmes': 'सक्रिय कार्यक्रम',
  'Certificates Issued': 'जारी प्रमाण पत्र',
  'Job Placements': 'रोजगार प्लेसमेंट',
  'Pending Nominations': 'लंबित नामांकन',
  'Upcoming Sessions': 'आगामी सत्र',
  'Hostel Occupancy': 'छात्रावास अधिभोग',
  'Attendance %': 'उपस्थिति प्रतिशत',
  'Average Attendance': 'औसत उपस्थिति',
  'Completion Rate': 'पूर्णता दर',
  'Placement Rate': 'प्लेसमेंट दर',
  'Today’s sessions': 'आज के सत्र',
  'Assigned batches': 'आवंटित बैच',
  'Total trainees': 'कुल शिक्षार्थी',
  'Today’s attendance': 'आज की उपस्थिति',
  'Pending assessments': 'लंबित मूल्यांकन',
  'Course progress': 'पाठ्यक्रम प्रगति',
  'Average batch score': 'औसत बैच स्कोर',
  'Completion rate': 'पूर्णता दर',
  'Active Jobs': 'सक्रिय नौकरियां',
  'Total Applicants': 'कुल आवेदक',
  'Shortlisted': 'शॉर्टलिस्टेड',
  'Interviews': 'साक्षात्कार',
  'Offers': 'प्रस्ताव',
  'Placements': 'नियुक्तियां',
  'Name': 'नाम',
  'Category': 'श्रेणी',
  'Location': 'स्थान',
  'State': 'राज्य',
  'Status': 'स्थिति',
  'Updated': 'अंतिम अपडेट',
  'Actions': 'कार्रवाई',
  'Room': 'कमरा',
  'Trainer': 'प्रशिक्षक',
  'Capacity': 'क्षमता',
  'Schedule': 'अनुसूची',
  'Start date': 'प्रारंभ तिथि',
  'End date': 'समाप्ति तिथि',
  'Coordinator': 'समन्वयक',
  'Duration': 'अवधि',

  // Statuses
  'Active': 'सक्रिय',
  'Verified': 'सत्यापित',
  'Pending': 'लंबित',
  'Approved': 'स्वीकृत',
  'Rejected': 'अस्वीकृत',
  'Draft': 'प्रारूप',
  'Published': 'प्रकाशित',
  'Archived': 'संग्रहीत',
  'Ongoing': 'प्रगति पर',
  'Scheduled': 'निर्धारित',
  'Completed': 'पूर्ण',
  'Cancelled': 'रद्द',
  'Available': 'उपलब्ध',
  'Allocated': 'आवंटित',
  'Assigned': 'आवंटित',
  'Occupied': 'अधिग्रहित',
  'Reserved': 'आरक्षित',
  'Vacant': 'रिक्त',
  'Present': 'उपस्थित',
  'Absent': 'अनुपस्थित',
  'Late': 'विलंबित',
  'Leave': 'अवकाश',
  'Hiring': 'भर्ती जारी',
  'Placed': 'नियुक्त',
  'Joined': 'शामिल हुए',
  'Healthy': 'उत्कृष्ट',
  'Ready': 'तैयार',
  'Rising': 'बढ़ता हुआ',
  'Enabled': 'सक्षम',
  'Eligible': 'पात्र',
  'Correction requested': 'सुधार अनुरोधित',
  'On track': 'सही प्रगति पर',
  'At risk': 'सहायता की आवश्यकता',

  // Stakeholders & Roles
  'NCCT Super Admin': 'एनसीसीटी सुपर एडमिन',
  'Institution Administrator': 'संस्थान व्यवस्थापक',
  'Trainer': 'प्रशिक्षक',
  'Trainee / Rural Youth': 'शिक्षार्थी / ग्रामीण युवा',
  'Employer / Recruiter': 'नियोक्ता / भर्तीकर्ता',
  'Institution Account': 'संस्थान खाता',
  'Super Admin': 'सुपर एडमिन',

  // Mottos & National Branding
  'Sahakar Se Samriddhi': 'सहकार से समृद्धि',
  'Cooperation for a Prosperous Bharat': 'सहकार से समृद्ध भारत',
  'National Cooperative Capacity Building Platform': 'राष्ट्रीय सहकारी क्षमता निर्माण मंच',
  'Ministry of Cooperation': 'सहकारिता मंत्रालय',
  'Government of India': 'भारत सरकार',
  'NCCT ADMIN CONTROL CENTER': 'एनसीसीटी सुपर एडमिन नियंत्रण केंद्र',
  'INSTITUTION WORKSPACE': 'संस्थान कार्यक्षेत्र',
  'TRAINER WORKSPACE': 'प्रशिक्षक कार्यक्षेत्र',
  'TRAINEE PORTAL': 'शिक्षार्थी पोर्टल',
  'EMPLOYER PORTAL': 'नियोक्ता पोर्टल',
  'Driving Cooperative Growth Across India': 'पूरे भारत में सहकारी विकास को गति देना',
  'One place for your people, programmes and training operations.': 'आपके लोगों, कार्यक्रमों और प्रशिक्षण संचालन के लिए एकीकृत मंच।',
  'Good day, Dr. Rajesh Kumar': 'नमस्ते, डॉ. राजेश कुमार',
  'Your classes, learners and progress in one place.': 'आपकी कक्षाएं, शिक्षार्थी और प्रगति एक ही स्थान पर।',
  'At a glance': 'एक नज़र में',
  'LIVE OVERVIEW': 'लाइव अवलोकन',
  'UP NEXT': 'आगामी',
  'LATEST': 'नवीनतम',
  'COHORTS': 'बैच समूह',
  'QUICK ACTIONS': 'त्वरित कार्रवाई',
  'Keep things moving': 'कार्य को गति दें',
  'Mark attendance': 'उपस्थिति दर्ज करें',
  'Create assessment': 'मूल्यांकन बनाएं',
  'Add learning material': 'शिक्षण सामग्री जोड़ें',
  'Teaching assistant': 'शिक्षण सहायक',
}

export interface I18nContextValue {
  language: LanguageTag
  setLanguage: (lang: LanguageTag) => void
  t: (keyOrEnglish: string, defaultText?: string) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<LanguageTag>('en')

  useEffect(() => {
    const saved = localStorage.getItem('nccp_lang') as LanguageTag
    if (saved && (saved === 'en' || saved === 'hi')) {
      setLanguageState(saved)
    }
  }, [])

  const setLanguage = useCallback((lang: LanguageTag) => {
    setLanguageState(lang)
    localStorage.setItem('nccp_lang', lang)
  }, [])

  const t = useCallback(
    (keyOrEnglish: string, defaultText?: string): string => {
      if (language === 'hi') {
        if (hindiDictionary[keyOrEnglish]) return hindiDictionary[keyOrEnglish]
        if (defaultText && hindiDictionary[defaultText]) return hindiDictionary[defaultText]
      }
      return defaultText || keyOrEnglish
    },
    [language]
  )

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return context
}
